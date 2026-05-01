/**
 * Send adapter: calendar_event — creates a calendar event with scratchpad content as description.
 */

import { execute } from '../../../executor/gws.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';
import { nextSteps } from '../../formatting/next-steps.js';

interface CalendarEventParams {
  email: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string;
}

export async function sendCalendarEvent(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  targetParams: CalendarEventParams,
): Promise<HandlerResponse> {
  const content = scratchpads.getContent(scratchpadId);
  if (content === null) {
    return { text: `Scratchpad ${scratchpadId} not found.`, refs: { error: true } };
  }

  const { email, summary, start, end, location, attendees } = targetParams;
  if (!email || !summary || !start || !end) {
    return {
      text: `Send failed: email, summary, start, and end are required for calendar_event.\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  const args = [
    'calendar', '+insert',
    '--summary', summary,
    '--start', start,
    '--end', end,
    '--description', content,
  ];
  if (location) args.push('--location', location);
  if (attendees) args.push('--attendee', attendees);

  try {
    const result = await execute(args, { account: email });
    const data = result.data as Record<string, unknown>;

    return {
      text: `Event created: **${summary}**\n\n` +
        `**When:** ${start} – ${end}\n` +
        (location ? `**Where:** ${location}\n` : '') +
        `**Description:** scratchpad content (${content.split('\n').length} lines)\n` +
        `**Event ID:** ${data.id ?? 'unknown'}` +
        nextSteps('calendar', 'create', { email }),
      refs: { scratchpadId, eventId: data.id, summary, start, end },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}
