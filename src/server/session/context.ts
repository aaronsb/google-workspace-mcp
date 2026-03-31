/**
 * Session context formatter — builds a markdown footer with ambient
 * workspace awareness (email deltas, next calendar event).
 */

import type { SessionTracker } from './tracker.js';

/** Format the session context footer for a tool response. */
export function sessionContext(
  _toolName: string,
  email: string | undefined,
  tracker: SessionTracker,
): string {
  if (!email) return '';

  const session = tracker.getContext(email);
  if (!session?.initialized) return '';

  const lines: string[] = [];

  // Email delta
  const delta = session.currentUnreadCount - session.baselineUnreadCount;
  if (delta > 0) {
    lines.push(`- ${delta} new unread email${delta !== 1 ? 's' : ''} since session start (${session.currentUnreadCount} unread, ${session.currentTodayEmailCount} today)`);
  } else if (delta < 0) {
    const abs = Math.abs(delta);
    lines.push(`- ${abs} fewer unread since session start (${session.currentUnreadCount} unread, ${session.currentTodayEmailCount} today)`);
  } else {
    lines.push(`- No new unread emails since session start (${session.currentUnreadCount} unread, ${session.currentTodayEmailCount} today)`);
  }

  // Next event
  if (session.nextEvent) {
    const label = formatEventTime(session.nextEvent.startTime);
    lines.push(`- Next: "${session.nextEvent.summary}" ${label}`);
  } else {
    lines.push('- No more events today');
  }

  return `\n\n---\n**Session context** (${email}):\n${lines.join('\n')}`;
}

/** Format event start as relative ("in 25 min") or absolute ("at 2:30 PM"). */
function formatEventTime(startTime: string): string {
  if (!startTime) return '';
  try {
    const start = new Date(startTime);
    if (isNaN(start.getTime())) return `at ${startTime}`;

    const diffMs = start.getTime() - Date.now();
    if (diffMs < 0) return 'now (started)';

    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 120) {
      return diffMin <= 1 ? 'in 1 min' : `in ${diffMin} min`;
    }

    return `at ${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  } catch {
    return `at ${startTime}`;
  }
}
