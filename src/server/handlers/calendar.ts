import { execute } from '../../executor/gws.js';
import { formatEventList, formatEventDetail } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';

export async function handleCalendar(params: Record<string, unknown>): Promise<unknown> {
  const operation = params.operation as string;
  const email = params.email as string;

  switch (operation) {
    case 'list': {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const result = await execute([
        'calendar', 'events', 'list',
        '--params', JSON.stringify({
          calendarId: 'primary',
          timeMin: params.timeMin || todayStart,
          timeMax: params.timeMax || undefined,
          maxResults: clamp(params.maxResults, 10, 50),
          singleEvents: true,
          orderBy: 'startTime',
        }),
      ], { account: email });
      return {
        ...formatEventList(result.data),
        ...nextSteps('calendar', 'list'),
      };
    }

    case 'agenda': {
      const result = await execute(['calendar', '+agenda'], { account: email });
      return { ...result.data as object, ...nextSteps('calendar', 'agenda') };
    }

    case 'create': {
      if (!params.summary) throw new Error('summary is required for create');
      if (!params.start) throw new Error('start is required for create');
      if (!params.end) throw new Error('end is required for create');
      const args = [
        'calendar', '+insert',
        '--summary', String(params.summary),
        '--start', String(params.start),
        '--end', String(params.end),
      ];
      if (params.description) args.push('--description', String(params.description));
      if (params.location) args.push('--location', String(params.location));
      if (params.attendees) args.push('--attendees', String(params.attendees));
      const result = await execute(args, { account: email });
      return { ...result.data as object, ...nextSteps('calendar', 'create') };
    }

    case 'get': {
      if (!params.eventId) throw new Error('eventId is required for get');
      const result = await execute([
        'calendar', 'events', 'get',
        '--params', JSON.stringify({ calendarId: 'primary', eventId: params.eventId }),
      ], { account: email });
      return {
        ...formatEventDetail(result.data),
        ...nextSteps('calendar', 'get', { eventId: params.eventId as string }),
      };
    }

    case 'delete': {
      if (!params.eventId) throw new Error('eventId is required for delete');
      const result = await execute([
        'calendar', 'events', 'delete',
        '--params', JSON.stringify({ calendarId: 'primary', eventId: params.eventId }),
      ], { account: email });
      return { status: 'deleted', eventId: params.eventId, ...nextSteps('calendar', 'delete') };
    }

    default:
      throw new Error(`Unknown calendar operation: ${operation}`);
  }
}

function clamp(value: unknown, defaultVal: number, max: number): number {
  const n = Number(value) || defaultVal;
  return Math.min(n, max);
}
