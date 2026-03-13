import { execute } from '../../executor/gws.js';
import { formatEventList, formatEventDetail } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';
import { requireEmail, requireString, clamp } from './validate.js';

export async function handleCalendar(params: Record<string, unknown>): Promise<unknown> {
  const operation = params.operation as string;
  const email = requireEmail(params);

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
      return { ...formatEventList(result.data), ...nextSteps('calendar', 'list') };
    }

    case 'agenda': {
      const result = await execute(['calendar', '+agenda'], { account: email });
      return { ...result.data as object, ...nextSteps('calendar', 'agenda') };
    }

    case 'create': {
      const summary = requireString(params, 'summary');
      const start = requireString(params, 'start');
      const end = requireString(params, 'end');
      const args = ['calendar', '+insert', '--summary', summary, '--start', start, '--end', end];
      if (params.description) args.push('--description', String(params.description));
      if (params.location) args.push('--location', String(params.location));
      if (params.attendees) args.push('--attendees', String(params.attendees));
      const result = await execute(args, { account: email });
      return { ...result.data as object, ...nextSteps('calendar', 'create') };
    }

    case 'get': {
      const eventId = requireString(params, 'eventId');
      const result = await execute([
        'calendar', 'events', 'get',
        '--params', JSON.stringify({ calendarId: 'primary', eventId }),
      ], { account: email });
      return { ...formatEventDetail(result.data), ...nextSteps('calendar', 'get', { eventId }) };
    }

    case 'delete': {
      const eventId = requireString(params, 'eventId');
      await execute([
        'calendar', 'events', 'delete',
        '--params', JSON.stringify({ calendarId: 'primary', eventId }),
      ], { account: email });
      return { status: 'deleted', eventId, ...nextSteps('calendar', 'delete') };
    }

    default:
      throw new Error(`Unknown calendar operation: ${operation}`);
  }
}
