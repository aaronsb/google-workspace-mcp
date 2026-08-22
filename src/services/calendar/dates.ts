/**
 * All-day event date handling for the calendar service.
 *
 * Google's Calendar API stores an all-day event's start/end as bare `date`
 * fields (YYYY-MM-DD), and the END DATE IS EXCLUSIVE — one day after the last
 * day of the event. A one-day event on 2026-07-12 therefore needs
 * `end: { date: '2026-07-13' }` (this is the classic all-day API gotcha).
 *
 * Callers of this MCP think in inclusive days ("from the 12th to the 14th"),
 * so these helpers accept an INCLUSIVE end and compute the exclusive one the
 * API requires. An end equal to (or before) the start means a single-day
 * event, so `exclusiveEndDate('2026-07-12', '2026-07-12')` is `2026-07-13`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Strict YYYY-MM-DD validation.
 *
 * Date.parse is too lenient here: V8 rolls an out-of-range day over
 * ('2026-02-30' silently becomes March 2). Parse the components and check they
 * round-trip through UTC, so a date that never existed is rejected.
 */
function isValidDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  return roundTrip.getUTCFullYear() === y &&
    roundTrip.getUTCMonth() === m - 1 &&
    roundTrip.getUTCDate() === d;
}

/**
 * Normalize an all-day start/end value to a YYYY-MM-DD date.
 *
 * Accepts a bare date ('2026-07-12') or an ISO datetime ('2026-07-12T09:00:00Z')
 * and uses the date part — all-day events have no time of day.
 */
export function allDayDate(value: string): string {
  const date = value.trim().slice(0, 10);
  if (!DATE_RE.test(date) || !isValidDate(date)) {
    throw new Error(`All-day events need dates in YYYY-MM-DD format (got "${value}")`);
  }
  return date;
}

/**
 * The EXCLUSIVE end date the Calendar API requires, from an INCLUSIVE last day.
 *
 * `end` is the last day the event covers. The API wants the day AFTER it, so a
 * multi-day event '2026-07-12 – 2026-07-14' becomes end.date '2026-07-15'. An
 * end that is equal to (or before) the start collapses to a single-day event
 * (start + 1 day) — the natural way to say "all day on July 12".
 */
export function exclusiveEndDate(start: string, end: string): string {
  const startDate = allDayDate(start);
  const endDate = allDayDate(end);

  // Parse against UTC midnight so the +1 day arithmetic is DST-proof.
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error(`Invalid all-day date range: "${start}" – "${end}"`);
  }

  const lastDayMs = Math.max(startMs, endMs);
  return new Date(lastDayMs + DAY_MS).toISOString().slice(0, 10);
}

/**
 * The inclusive range for DISPLAY, from the caller's raw values.
 *
 * A single-day event (end equal to or before start, or no end) renders as just
 * the date; a multi-day one renders as `start – end`.
 */
export function allDayRange(start: string, end?: string): string {
  const startDate = allDayDate(start);
  if (end === undefined) return startDate;
  const endDate = allDayDate(end);
  return endDate > startDate ? `${startDate} – ${endDate}` : startDate;
}
