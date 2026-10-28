/**
 * Event fields the Calendar API takes as-is but a model has to be told how to spell:
 * the colour id, the recurrence rule lines and the time zone.
 */

/**
 * Whether a parameter was given. Tool arguments are not checked against the input schema, so a
 * colour may arrive as a number or a rule list as an array; presence is decided here, not by type.
 */
export function isGiven(raw: unknown): boolean {
  return raw !== undefined && raw !== null && String(raw).trim() !== '';
}

/** An IANA time zone name, checked the way the runtime resolves it so a bad one is refused before Google sees it. */
export function validTimeZone(raw: unknown): string {
  const value = String(raw).trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw new Error(`timeZone must be an IANA time zone name such as Europe/Amsterdam, got "${value}"`);
  }
  return value;
}

/** An event's colour is one of eleven ids, "1" to "11" (the `event` set of the Calendar colors resource). */
export function eventColorId(raw: unknown): string {
  const value = String(raw).trim();
  if (!/^(?:[1-9]|1[01])$/.test(value)) {
    throw new Error(`colorId must be a number from 1 to 11 (the Calendar API's event colours), got "${value}"`);
  }
  return value;
}

const RULE_LINE = /^((?:RRULE|EXRULE|RDATE|EXDATE))([:;])/i;

/**
 * The `recurrence` array of an event, from the one-string form the tool takes: one RFC 5545 line per
 * line of the string, or an array of such lines (RRULE, EXRULE, RDATE or EXDATE). A bare rule that starts with FREQ= gets its
 * RRULE: prefix, so `FREQ=WEEKLY;BYDAY=MO` and `RRULE:FREQ=WEEKLY;BYDAY=MO` mean the same thing.
 * The keyword is upper-cased. Anything else is refused here, with the accepted forms named, rather than sent to Google to 400.
 */
export function parseRecurrence(raw: unknown): string[] {
  const lines = (Array.isArray(raw) ? raw.map(String).join('\n') : String(raw)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error('recurrence needs at least one line, for example RRULE:FREQ=WEEKLY;BYDAY=MO');
  }
  return lines.map((line) => {
    if (RULE_LINE.test(line)) return line.replace(RULE_LINE, (_m, kw: string, sep: string) => kw.toUpperCase() + sep);
    if (/^FREQ=/i.test(line)) return `RRULE:${line}`;
    throw new Error(
      `recurrence lines must start with RRULE:, EXRULE:, RDATE: or EXDATE: ` +
      `(for example RRULE:FREQ=WEEKLY;BYDAY=MO), got "${line}"`,
    );
  });
}
