/**
 * Send adapter: calendar_event — creates a calendar event with scratchpad content as description.
 */

import { call } from '../../../google/client.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';
import { nextSteps } from '../../formatting/next-steps.js';
import { allDayDate, exclusiveEndDate, allDayRange } from '../../../services/calendar/dates.js';

interface CalendarEventParams {
  email: string;
  summary: string;
  start: string;
  end?: string;
  allDay?: boolean;
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

  const { email, summary, start, end, location, attendees, allDay = false } = targetParams;
  if (!email || !summary || !start || (!allDay && !end)) {
    return {
      text: `Send failed: email, summary, and start are required for calendar_event` +
        (allDay ? '.' : ', and end is required for timed events (or pass allDay: true).') +
        `\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  // `calendarId` is the one PATH param the descriptor declares; everything else
  // here is the Event resource and lands in the body. Same shape as
  // services/calendar/patch.ts `create` — all-day events use `date`
  // (YYYY-MM-DD, exclusive API end computed from the caller's inclusive end),
  // timed ones use `dateTime`.
  const body: Record<string, unknown> = {
    calendarId: 'primary',
    summary,
    description: content,
  };
  if (allDay) {
    body.start = { date: allDayDate(start) };
    body.end = { date: exclusiveEndDate(start, end ?? start) };
  } else {
    body.start = { dateTime: start };
    body.end = { dateTime: end };
  }
  if (location) body.location = location;
  if (attendees) {
    body.attendees = attendees
      .split(',').map((e) => e.trim()).filter(Boolean)
      .map((address) => ({ email: address }));
  }

  try {
    const data = await call('calendar', 'events.insert', body, { account: email }) as Record<string, unknown>;

    const when = allDay ? allDayRange(start, end) : `${start} – ${end}`;
    return {
      text: `Event created: **${summary}**${allDay ? ' (all day)' : ''}\n\n` +
        `**When:** ${when}\n` +
        (location ? `**Where:** ${location}\n` : '') +
        `**Description:** scratchpad content (${content.split('\n').length} lines)\n` +
        `**Event ID:** ${data.id ?? 'unknown'}` +
        nextSteps('calendar', 'create', { email }),
      refs: { scratchpadId, eventId: data.id, summary, start, end, allDay },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}
