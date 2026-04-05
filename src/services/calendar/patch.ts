/**
 * Calendar patch — domain-specific hooks for the calendar service.
 *
 * Key customizations:
 * - List: default timeMin to today start
 * - Agenda: raw text passthrough with event refs extraction
 * - Create: custom response formatting with event details
 * - Delete: custom confirmation message
 */

import { execute } from '../../executor/gws.js';
import { formatEventList, formatEventDetail } from '../../server/formatting/markdown.js';
import { nextSteps } from '../../server/formatting/next-steps.js';
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
        return formatEventList(data);
    }
  },
  formatDetail: (data: unknown) => formatEventDetail(data),

  customHandlers: {
    agenda: async (params, account): Promise<HandlerResponse> => {
      const result = await execute(['calendar', '+agenda'], { account });
      const data = result.data as Record<string, unknown> | undefined;
      const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
      const events = Array.isArray(data?.events) ? data.events : [];
      return {
        text: text + nextSteps('calendar', 'agenda', { email: account }),
        refs: {
          count: events.length,
          eventId: events[0]?.id,
          events: events.map((e: Record<string, unknown>) => e.id),
        },
      };
    },

    create: async (params, account): Promise<HandlerResponse> => {
      const summary = requireString(params, 'summary');
      const start = requireString(params, 'start');
      const end = requireString(params, 'end');
      const calendarId = (params.calendarId as string) || 'primary';
      const args = ['calendar', '+insert', '--calendar', calendarId, '--summary', summary, '--start', start, '--end', end];
      if (params.description) args.push('--description', String(params.description));
      if (params.location) args.push('--location', String(params.location));
      if (params.attendees) args.push('--attendees', String(params.attendees));
      const result = await execute(args, { account });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Event created: **${summary}**\n\n` +
          `**When:** ${start} – ${end}\n` +
          (params.location ? `**Where:** ${params.location}\n` : '') +
          `**Event ID:** ${data.id ?? 'unknown'}` +
          nextSteps('calendar', 'create', { email: account }),
        refs: { id: data.id, eventId: data.id, summary, start, end },
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
        text: `Event deleted: ${eventId}` + nextSteps('calendar', 'delete', { email: account }),
        refs: { eventId, status: 'deleted' },
      };
    },
  },
};
