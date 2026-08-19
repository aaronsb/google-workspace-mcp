import { describe, expect, it } from 'vitest';

import { allDayDate, exclusiveEndDate, allDayRange } from '../../../services/calendar/dates.js';

describe('calendar all-day date helpers', () => {
  describe('allDayDate', () => {
    it('passes a bare YYYY-MM-DD through', () => {
      expect(allDayDate('2026-07-12')).toBe('2026-07-12');
    });

    it('takes the date part of an ISO datetime', () => {
      expect(allDayDate('2026-07-12T09:30:00Z')).toBe('2026-07-12');
      expect(allDayDate('2026-07-12T23:59:59-05:00')).toBe('2026-07-12');
    });

    it('rejects non-dates', () => {
      expect(() => allDayDate('noon')).toThrow(/YYYY-MM-DD/);
      expect(() => allDayDate('2026-7-2')).toThrow(/YYYY-MM-DD/);
    });
  });

  describe('exclusiveEndDate', () => {
    // The Calendar API's all-day end is one day AFTER the last day of the event.
    it('makes a same-day range a one-day event', () => {
      expect(exclusiveEndDate('2026-07-12', '2026-07-12')).toBe('2026-07-13');
    });

    it('treats end as the INCLUSIVE last day and adds one', () => {
      expect(exclusiveEndDate('2026-07-12', '2026-07-14')).toBe('2026-07-15');
    });

    it('collapses an end before the start to a one-day event', () => {
      expect(exclusiveEndDate('2026-07-14', '2026-07-12')).toBe('2026-07-15');
    });

    it('is DST-proof (UTC arithmetic)', () => {
      // Around a DST boundary in most zones; UTC has no DST so this is stable.
      expect(exclusiveEndDate('2026-03-07', '2026-03-08')).toBe('2026-03-09');
    });

    it('rejects an invalid calendar date (e.g. Feb 30)', () => {
      expect(() => exclusiveEndDate('2026-02-30', '2026-03-01')).toThrow(/YYYY-MM-DD/);
      expect(() => exclusiveEndDate('2026-07-12', '2026-13-01')).toThrow(/YYYY-MM-DD/);
    });
  });

  describe('allDayRange', () => {
    it('renders a single-day event as just the date', () => {
      expect(allDayRange('2026-07-12')).toBe('2026-07-12');
      expect(allDayRange('2026-07-12', '2026-07-12')).toBe('2026-07-12');
    });

    it('renders a multi-day range inclusively', () => {
      expect(allDayRange('2026-07-12', '2026-07-14')).toBe('2026-07-12 – 2026-07-14');
    });
  });
});
