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

import { execute } from '../../executor/gws.js';
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

/** Format agenda events with calendarId per event. */
function formatAgenda(data: unknown, account: string): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const events = (raw?.events ?? []) as Array<Record<string, unknown>>;
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return {
    text,
    refs: {
      count: events.length,
      eventId: events[0]?.id as string | undefined,
      events: events.map((e: Record<string, unknown>) => ({
        id: e.id,
        calendarId: e.calendarId ?? (e.organizer && (e.organizer as Record<string, unknown>).email),
      })),
    },
  };
}

export const calendarPatch: ServicePatch = {
  beforeExecute: {
    list: async (args, ctx) => {
      // Inject default timeMin (today start) if not provided
      if (!ctx.params.timeMin) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        // Patch the --params JSON to include timeMin
        const paramsIdx = args.indexOf('--params');
        if (paramsIdx !== -1) {
          const gwsParams = JSON.parse(args[paramsIdx + 1]);
          if (!gwsParams.timeMin) {
            gwsParams.timeMin = todayStart;
          }
          args[paramsIdx + 1] = JSON.stringify(gwsParams);
        }
      }
      return args;
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
    agenda: async (params, account): Promise<HandlerResponse> => {
      const args = ['calendar', '+agenda'];

      // Day-range flags
      if (params.tomorrow) args.push('--tomorrow');
      else if (params.week) args.push('--week');
      else if (params.days) args.push('--days', String(params.days));
      else args.push('--today');

      // Calendar filter
      if (params.calendarId) args.push('--calendar', String(params.calendarId));

      const result = await execute(args, { account });
      return formatAgenda(result.data, account);
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

      const body = { timeMin, timeMax, items };
      const args = ['calendar', 'freebusy', 'query', '--json', JSON.stringify(body)];
      const result = await execute(args, { account });
      return formatFreeBusy(result.data, { operation: 'freebusy', params, account });
    },

    create: async (params, account): Promise<HandlerResponse> => {
      const summary = requireString(params, 'summary');
      const start = requireString(params, 'start');
      const end = requireString(params, 'end');
      const calendarId = (params.calendarId as string) || 'primary';
      const args = ['calendar', '+insert', '--calendar', calendarId, '--summary', summary, '--start', start, '--end', end];
      if (params.description) args.push('--description', String(params.description));
      if (params.location) args.push('--location', String(params.location));
      if (params.attendees) {
        for (const email of String(params.attendees).split(',').map(e => e.trim()).filter(Boolean)) {
          args.push('--attendee', email);
        }
      }
      if (params.meet) args.push('--meet');
      const result = await execute(args, { account });
      const data = result.data as Record<string, unknown>;
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
      await execute([
        'calendar', 'events', 'delete',
        '--params', JSON.stringify({ calendarId, eventId }),
      ], { account });
      return {
        text: `Event deleted: ${eventId}`,
        refs: { eventId, status: 'deleted' },
      };
    },
  },
};
