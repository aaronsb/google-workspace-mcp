import { execute } from '../../executor/gws.js';
import { formatEventList, formatEventDetail } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';
import { requireEmail, requireString, clamp } from './validate.js';
import type { HandlerResponse } from '../handler.js';

export async function handleCalendar(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;
  const email = requireEmail(params);

  switch (operation) {
    case 'list': {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const calendarId = (params.calendarId as string) || 'primary';
      const result = await execute([
        'calendar', 'events', 'list',
        '--params', JSON.stringify({
          calendarId,
          timeMin: params.timeMin || todayStart,
          timeMax: params.timeMax || undefined,
          maxResults: clamp(params.maxResults, 10, 50),
          singleEvents: true,
          orderBy: 'startTime',
        }),
      ], { account: email });
      const formatted = formatEventList(result.data);
      return {
        text: formatted.text + nextSteps('calendar', 'list', { email }),
        refs: formatted.refs,
      };
    }

    case 'agenda': {
      const result = await execute(['calendar', '+agenda'], { account: email });
      const data = result.data as Record<string, unknown> | undefined;
      const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
      // Curate refs — only expose fields useful for chaining
      const events = Array.isArray(data?.events) ? data.events : [];
      return {
        text: text + nextSteps('calendar', 'agenda', { email }),
        refs: {
          count: events.length,
          eventId: events[0]?.id,
          events: events.map((e: Record<string, unknown>) => e.id),
        },
      };
    }

    case 'create': {
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
      const result = await execute(args, { account: email });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Event created: **${summary}**\n\n` +
          `**When:** ${start} – ${end}\n` +
          (params.location ? `**Where:** ${params.location}\n` : '') +
          `**Event ID:** ${data.id ?? 'unknown'}` +
          nextSteps('calendar', 'create', { email }),
        refs: { id: data.id, eventId: data.id, summary, start, end },
      };
    }

    case 'get': {
      const eventId = requireString(params, 'eventId');
      const calendarId = (params.calendarId as string) || 'primary';
      const result = await execute([
        'calendar', 'events', 'get',
        '--params', JSON.stringify({ calendarId, eventId }),
      ], { account: email });
      const formatted = formatEventDetail(result.data);
      return {
        text: formatted.text + nextSteps('calendar', 'get', { email, eventId }),
        refs: formatted.refs,
      };
    }

    case 'delete': {
      const eventId = requireString(params, 'eventId');
      const calendarId = (params.calendarId as string) || 'primary';
      await execute([
        'calendar', 'events', 'delete',
        '--params', JSON.stringify({ calendarId, eventId }),
      ], { account: email });
      return {
        text: `Event deleted: ${eventId}` + nextSteps('calendar', 'delete', { email }),
        refs: { eventId, status: 'deleted' },
      };
    }

    default:
      throw new Error(`Unknown calendar operation: ${operation}`);
  }
}
