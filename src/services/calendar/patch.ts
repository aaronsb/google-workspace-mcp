/**
 * Calendar patch — domain-specific hooks for the calendar service.
 *
 * Key customizations:
 * - List: default timeMin to today start, include calendarId in output
 * - Agenda: rich helper with day-range params, calendarId per event
 * - Freebusy: custom handler (POST body via --json, not --params)
 * - Create: custom response formatting with event details + --meet flag
 * - Delete: custom confirmation message
 */

import { createHash } from 'node:crypto';

import { call } from '../../google/client.js';
import { formatEventList, formatEventDetail } from '../../server/formatting/markdown.js';
import { requireString } from '../../server/handlers/validate.js';
import type { ServicePatch, PatchContext } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

/** Format calendar list — name, access role, primary flag. */
function formatCalendarList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.items ?? []) as Array<Record<string, unknown>>;

  if (items.length === 0) {
    return { text: 'No calendars found.', refs: { count: 0 } };
  }

  const lines = items.map(cal => {
    const id = String(cal.id ?? '');
    const summary = String(cal.summary ?? '(unnamed)');
    const role = String(cal.accessRole ?? '');
    const primary = cal.primary ? ' ★' : '';
    return `${summary}${primary} | ${role} | ${id}`;
  });

  return {
    text: `## Calendars (${items.length})\n\n${lines.join('\n')}`,
    refs: {
      count: items.length,
      calendarId: String(items[0]?.id ?? ''),
      calendars: items.map(c => ({ id: c.id, summary: c.summary })),
    },
  };
}

/** Format event list with calendarId enrichment. */
function formatEventListWithCalendar(data: unknown, ctx: PatchContext): HandlerResponse {
  const result = formatEventList(data);
  const calendarId = (ctx.params.calendarId as string) || 'primary';

  // Enrich refs with calendarId so follow-up get calls work on shared calendars
  result.refs = { ...result.refs, calendarId };

  // Add calendarId hint to output when not primary
  if (calendarId !== 'primary') {
    result.text = result.text.replace(
      /^## Events/,
      `## Events (calendar: ${calendarId})`,
    );
  }

  return result;
}

/** Format freebusy response into readable busy/free blocks. */
function formatFreeBusy(data: unknown, ctx: PatchContext): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const calendars = (raw?.calendars ?? {}) as Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ domain: string; reason: string }> }>;

  const parts: string[] = ['## Availability\n'];
  const allBusy: Array<{ calendar: string; start: string; end: string }> = [];

  for (const [calId, info] of Object.entries(calendars)) {
    // Surface API errors (e.g., permission denied on a calendar)
    if (info.errors && info.errors.length > 0) {
      const reasons = info.errors.map(e => e.reason).join(', ');
      parts.push(`**${calId}**: ⚠ Unable to check (${reasons})`);
      continue;
    }
    const busy = info.busy ?? [];
    if (busy.length === 0) {
      parts.push(`**${calId}**: Free for entire range`);
    } else {
      parts.push(`**${calId}**: ${busy.length} busy block${busy.length !== 1 ? 's' : ''}`);
      for (const block of busy) {
        const start = new Date(block.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const end = new Date(block.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        parts.push(`  - ${start} – ${end}`);
        allBusy.push({ calendar: calId, start: block.start, end: block.end });
      }
    }
  }

  return {
    text: parts.join('\n'),
    refs: {
      calendars: Object.keys(calendars),
      busyBlocks: allBusy,
      timeMin: ctx.params.timeMin,
      timeMax: ctx.params.timeMax,
    },
  };
}

/** An event merged from one of the account's calendars. */
interface AgendaEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  summary: string;
  location: string;
  /** RFC 3339 for a timed event; a bare YYYY-MM-DD for an all-day one. */
  start: string;
  end: string;
  allDay: boolean;
}

/**
 * Compute the agenda window.
 *
 * gws's flags are not what they sound like, and we keep the names but fix the
 * semantics: its `--week` is NOT a calendar week — it sets days=7 and produces a
 * rolling `[now, now+7d]`. That means "this week" silently excluded everything
 * earlier today. Here every window starts at the START OF A DAY, which is what a
 * person means when they ask for their agenda.
 */
function agendaWindow(params: Record<string, unknown>): { timeMin: string; timeMax: string } {
  const startOfDay = (offsetDays: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  if (params.tomorrow === true || params.tomorrow === 'true') {
    return { timeMin: startOfDay(1).toISOString(), timeMax: startOfDay(2).toISOString() };
  }
  const days = params.week === true || params.week === 'true'
    ? 7
    : Number(params.days ?? 1) || 1;
  return { timeMin: startOfDay(0).toISOString(), timeMax: startOfDay(days).toISOString() };
}

/** Render the merged agenda. Grouped by day, because that is how a day is read. */
function formatAgenda(events: AgendaEvent[], window: { timeMin: string; timeMax: string }): HandlerResponse {
  if (events.length === 0) {
    return {
      text: 'No events scheduled.',
      refs: { count: 0, timeMin: window.timeMin, timeMax: window.timeMax },
    };
  }

  const dayOf = (e: AgendaEvent) => e.start.slice(0, 10);
  const time = (e: AgendaEvent) =>
    e.allDay
      ? 'all day'
      : new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const lines: string[] = [];
  let currentDay = '';
  for (const e of events) {
    const day = dayOf(e);
    if (day !== currentDay) {
      currentDay = day;
      const label = new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric',
      });
      lines.push(`${lines.length ? '\n' : ''}### ${label}`);
    }
    const where = e.location ? ` — ${e.location}` : '';
    const whose = e.calendarName ? ` _(${e.calendarName})_` : '';
    lines.push(`- **${time(e)}** ${e.summary}${where}${whose}`);
  }

  return {
    text: `## Agenda (${events.length} event${events.length === 1 ? '' : 's'})\n\n${lines.join('\n')}`,
    refs: {
      count: events.length,
      timeMin: window.timeMin,
      timeMax: window.timeMax,
      eventId: events[0]?.id,
      // calendarId per event: a follow-up `get` on a shared calendar needs it,
      // and it is the whole reason this operation exists rather than `list`.
      events: events.map((e) => ({ id: e.id, calendarId: e.calendarId, summary: e.summary })),
    },
  };
}

export const calendarPatch: ServicePatch = {
  beforeExecute: {
    // Default the range to "from the start of today" when the caller gave none.
    //
    // This used to reach into an argv slot and re-serialise its JSON:
    //   const i = args.indexOf('--params'); JSON.parse(args[i + 1]) …
    // — surgery on a command line, only because the seam WAS a command line.
    // The hook now receives the params themselves (ADR-103).
    list: async (params) => {
      if (params.timeMin) return params;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      return { ...params, timeMin: todayStart };
    },
  },

  formatList: (data: unknown, ctx: PatchContext) => {
    switch (ctx.operation) {
      case 'calendars':
        return formatCalendarList(data);
      default:
        return formatEventListWithCalendar(data, ctx);
    }
  },
  formatDetail: (data: unknown) => formatEventDetail(data),

  customHandlers: {
    /**
     * Agenda: every calendar the account can see, merged into one timeline.
     *
     * Was gws's `+agenda` — one of only two helpers that RESHAPED Google's
     * response (it emitted a `{events:[{calendar,start,end,summary,location}]}`
     * that the Calendar API never returns). We drop that shape and build our own
     * from raw Google, which is the point of owning the layer.
     *
     * Two of gws's behaviours are deliberately NOT reproduced, because they are
     * defects rather than opinions:
     *   - it SWALLOWED per-calendar failures (`_ => return vec![]`), so a calendar
     *     you had lost access to contributed zero events and said nothing. We
     *     surface it.
     *   - it capped at 50 events per calendar with NO pagination, so a busy
     *     calendar silently lost the tail. We ask for the window we were asked for.
     */
    agenda: async (params, account): Promise<HandlerResponse> => {
      const window = agendaWindow(params);

      const calList = await call('calendar', 'calendarList.list', {}, { account }) as Record<string, unknown>;
      let calendars = ((calList.items ?? []) as Array<Record<string, unknown>>)
        .filter((c) => c.id);

      // Optional filter: match an id exactly, or a display name by substring.
      if (params.calendarId) {
        const needle = String(params.calendarId).toLowerCase();
        calendars = calendars.filter((c) =>
          String(c.id).toLowerCase() === needle ||
          String(c.summary ?? '').toLowerCase().includes(needle));
        if (calendars.length === 0) {
          return {
            text: `No calendar matches "${params.calendarId}". Use the \`calendars\` operation to list them.`,
            refs: { count: 0 },
          };
        }
      }

      const failures: string[] = [];
      const perCalendar = await Promise.all(calendars.map(async (cal) => {
        const calendarId = String(cal.id);
        const calendarName = String(cal.summary ?? calendarId);
        try {
          const res = await call('calendar', 'events.list', {
            calendarId,
            timeMin: window.timeMin,
            timeMax: window.timeMax,
            singleEvents: true,          // expand recurrences into instances
            orderBy: 'startTime',
          }, { account }) as Record<string, unknown>;

          return ((res.items ?? []) as Array<Record<string, unknown>>).map((e): AgendaEvent => {
            const start = e.start as { dateTime?: string; date?: string } | undefined;
            const end = e.end as { dateTime?: string; date?: string } | undefined;
            const allDay = !start?.dateTime;
            return {
              id: String(e.id ?? ''),
              calendarId,
              calendarName,
              summary: String(e.summary ?? '(no title)'),
              location: String(e.location ?? ''),
              start: String(start?.dateTime ?? start?.date ?? ''),
              end: String(end?.dateTime ?? end?.date ?? ''),
              allDay,
            };
          });
        } catch (err) {
          // Do NOT swallow this. A calendar that cannot be read is information.
          failures.push(`${calendarName}: ${err instanceof Error ? err.message : String(err)}`);
          return [];
        }
      }));

      // Merge and sort. All-day events (a bare date) sort before timed events on
      // the same day, which is what a reader expects.
      const events = perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start));

      const response = formatAgenda(events, window);
      if (failures.length > 0) {
        response.text += `\n\n> ⚠ ${failures.length} calendar(s) could not be read:\n` +
          failures.map((f) => `> - ${f}`).join('\n');
        response.refs = { ...response.refs, unreadableCalendars: failures };
      }
      return response;
    },

    freebusy: async (params, account): Promise<HandlerResponse> => {
      const timeMin = requireString(params, 'timeMin');
      const timeMax = requireString(params, 'timeMax');

      // Build calendar items list from attendees + own calendar (deduplicated)
      const seen = new Set<string>([account]);
      const items: Array<{ id: string }> = [{ id: account }];
      const addItem = (id: string) => { if (!seen.has(id)) { seen.add(id); items.push({ id }); } };

      if (params.attendees) {
        for (const email of String(params.attendees).split(',').map(e => e.trim()).filter(Boolean)) {
          addItem(email);
        }
      }
      if (params.calendarId) {
        for (const id of String(params.calendarId).split(',').map(e => e.trim()).filter(Boolean)) {
          addItem(id);
        }
      }

      const data = await call('calendar', 'freebusy.query', { timeMin, timeMax, items }, { account });
      return formatFreeBusy(data, { operation: 'freebusy', params, account });
    },

    create: async (params, account): Promise<HandlerResponse> => {
      const summary = requireString(params, 'summary');
      const start = requireString(params, 'start');
      const end = requireString(params, 'end');
      const calendarId = (params.calendarId as string) || 'primary';

      // Was gws's `+insert`. The whole `--attendee` (singular!) vs `--attendees`
      // business — an entire comment explaining which spelling the CLI would
      // accept — evaporates with the CLI. It is a JSON body now.
      const body: Record<string, unknown> = {
        calendarId,
        summary,
        start: { dateTime: start },
        end: { dateTime: end },
      };
      if (params.description) body.description = String(params.description);
      if (params.location) body.location = String(params.location);
      if (params.attendees) {
        body.attendees = String(params.attendees)
          .split(',').map((e) => e.trim()).filter(Boolean)
          .map((email) => ({ email }));
      }

      if (params.meet) {
        // Ask Google to mint a Meet link. `requestId` is an IDEMPOTENCY KEY: reuse
        // it and Google reuses the conference instead of creating a second one.
        // gws derived it deterministically (a UUIDv5 over the event fields) so a
        // retried create could not double-book — a good idea, and kept.
        const fingerprint = createHash('sha256')
          .update(JSON.stringify({ calendarId, summary, start, end, location: params.location ?? '' }))
          .digest('hex').slice(0, 32);
        body.conferenceData = {
          createRequest: {
            requestId: fingerprint,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        };
        body.conferenceDataVersion = 1;   // required, or Google ignores conferenceData entirely
      }

      const data = await call('calendar', 'events.insert', body, { account }) as Record<string, unknown>;
      const meetLink = params.meet ? ' (with Google Meet)' : '';
      return {
        text: `Event created: **${summary}**${meetLink}\n\n` +
          `**When:** ${start} – ${end}\n` +
          (params.location ? `**Where:** ${params.location}\n` : '') +
          `**Calendar:** ${calendarId}\n` +
          `**Event ID:** ${data.id ?? 'unknown'}`,
        refs: { id: data.id, eventId: data.id, calendarId, summary, start, end },
      };
    },

    delete: async (params, account): Promise<HandlerResponse> => {
      const eventId = requireString(params, 'eventId');
      const calendarId = (params.calendarId as string) || 'primary';
      await call('calendar', 'events.delete', { calendarId, eventId }, { account });
      return {
        text: `Event deleted: ${eventId}`,
        refs: { eventId, status: 'deleted' },
      };
    },

    update: async (params, account): Promise<HandlerResponse> => {
      // events.patch takes `calendarId` + `eventId` via --params (path/query)
      // and the changed fields as a JSON body via --json. The manifest-driven
      // generator only emits --params, so without this handler the body is
      // empty and Google returns 200 without applying anything — silently.
      const eventId = requireString(params, 'eventId');
      const calendarId = (params.calendarId as string) || 'primary';

      const body: Record<string, unknown> = {};
      if (params.summary !== undefined) body.summary = String(params.summary);
      if (params.description !== undefined) body.description = String(params.description);
      if (params.location !== undefined) body.location = String(params.location);
      if (params.start !== undefined) body.start = { dateTime: String(params.start) };
      if (params.end !== undefined) body.end = { dateTime: String(params.end) };

      // attendees: comma-separated string → array of {email} objects.
      // Google events.patch replaces the attendees array wholesale (no diff semantics),
      // so the caller must re-supply every guest they want kept.
      if (params.attendees !== undefined) {
        const attendeeList = String(params.attendees)
          .split(',')
          .map(e => e.trim())
          .filter(Boolean);
        body.attendees = attendeeList.map(email => ({ email }));
      }

      // Build --params: note the conferenceDataVersion=1 requirement when creating a Meet link.
      const queryParams: Record<string, unknown> = { calendarId, eventId };

      // Optional Meet link attach. Google Calendar does not allow removing a Meet link
      // via events.patch, so we only handle the "add" case.
      if (params.meet) {
        const requestId = `meet-${eventId}-${Date.now()}`;
        body.conferenceData = {
          createRequest: {
            requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        };
        queryParams.conferenceDataVersion = 1;
      }

      if (Object.keys(body).length === 0) {
        throw new Error(
          'update requires at least one field to change: summary, start, end, description, location, attendees, or meet',
        );
      }

      const data = await call('calendar', 'events.patch', {
        ...queryParams,
        ...body,
      }, { account }) as Record<string, unknown>;

      const changed = Object.keys(body);
      const meetLink = data.hangoutLink ? `\n**Meet:** ${data.hangoutLink}` : '';
      return {
        text: `Event updated: **${data.summary ?? eventId}**\n\n` +
          `**Event ID:** ${data.id ?? eventId}\n` +
          `**Calendar:** ${calendarId}\n` +
          `**Fields changed:** ${changed.join(', ')}` +
          meetLink,
        refs: {
          id: data.id,
          eventId: data.id ?? eventId,
          calendarId,
          changed,
          ...(data.hangoutLink ? { meetLink: data.hangoutLink } : {}),
        },
      };
    },
  },
};
