/**
 * Event fields the Calendar API takes as-is but a model has to be told how to spell:
 * the colour id and the recurrence rule lines.
 */

/** An event's colour is one of eleven ids, "1" to "11" (the `event` set of the Calendar colors resource). */
export function eventColorId(raw: unknown): string {
  const value = String(raw).trim();
  if (!/^(?:[1-9]|1[01])$/.test(value)) {
    throw new Error(`colorId must be a number from 1 to 11 (the Calendar API's event colours), got "${value}"`);
  }
  return value;
}

const RULE_LINE = /^(?:RRULE|EXRULE|RDATE|EXDATE)[:;]/i;

/**
 * The `recurrence` array of an event, from the one-string form the tool takes: one RFC 5545 line per
 * line of the string (RRULE, EXRULE, RDATE or EXDATE). A bare rule that starts with FREQ= gets its
 * RRULE: prefix, so `FREQ=WEEKLY;BYDAY=MO` and `RRULE:FREQ=WEEKLY;BYDAY=MO` mean the same thing.
 * Anything else is refused here, with the accepted forms named, rather than sent to Google to 400.
 */
export function parseRecurrence(raw: unknown): string[] {
  const lines = String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error('recurrence needs at least one line, for example RRULE:FREQ=WEEKLY;BYDAY=MO');
  }
  return lines.map((line) => {
    if (RULE_LINE.test(line)) return line;
    if (/^FREQ=/i.test(line)) return `RRULE:${line}`;
    throw new Error(
      `recurrence lines must start with RRULE:, EXRULE:, RDATE: or EXDATE: ` +
      `(for example RRULE:FREQ=WEEKLY;BYDAY=MO), got "${line}"`,
    );
  });
}
