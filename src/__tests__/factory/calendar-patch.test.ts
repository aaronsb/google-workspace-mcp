/**
 * Tests for the calendar service patch — custom handlers and formatters
 * that extend the factory-generated handler.
 */

import {
  mockExecute, mockGwsResponse,
  calendarAgendaResponse, calendarEventsListResponse, calendarInsertResponse,
  calendarFreeBusyResponse, calendarFreeBusyErrorResponse,
} from '../server/handlers/__mocks__/executor.js';
import { calendarPatch } from '../../services/calendar/patch.js';
import type { PatchContext } from '../../factory/types.js';

function ctx(overrides: Partial<PatchContext> = {}): PatchContext {
  return {
    operation: 'list',
    params: {},
    account: 'user@test.com',
    ...overrides,
  };
}

describe('calendarPatch', () => {
  beforeEach(() => mockExecute.mockReset());

  describe('formatList (events)', () => {
    it('defaults calendarId to primary in refs', () => {
      const result = calendarPatch.formatList!(calendarEventsListResponse, ctx({ operation: 'list' }));
      expect(result.refs.calendarId).toBe('primary');
    });

    it('enriches refs with calendarId for shared calendars', () => {
      const result = calendarPatch.formatList!(
        calendarEventsListResponse,
        ctx({ operation: 'list', params: { calendarId: 'shared@test.com' } }),
      );
      expect(result.refs.calendarId).toBe('shared@test.com');
    });

    it('adds calendar hint to output header for non-primary calendars', () => {
      const result = calendarPatch.formatList!(
        calendarEventsListResponse,
        ctx({ operation: 'list', params: { calendarId: 'shared@test.com' } }),
      );
      expect(result.text).toContain('calendar: shared@test.com');
    });

    it('does not add hint for primary calendar', () => {
      const result = calendarPatch.formatList!(calendarEventsListResponse, ctx({ operation: 'list' }));
      expect(result.text).not.toContain('calendar:');
    });
  });

  describe('agenda custom handler', () => {
    it('defaults to --today flag', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarAgendaResponse));
      await calendarPatch.customHandlers!.agenda({}, 'user@test.com');

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('--today');
    });

    it('passes --week flag', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarAgendaResponse));
      await calendarPatch.customHandlers!.agenda({ week: true }, 'user@test.com');

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('--week');
      expect(args).not.toContain('--today');
    });

    it('passes --tomorrow flag', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarAgendaResponse));
      await calendarPatch.customHandlers!.agenda({ tomorrow: true }, 'user@test.com');

      expect(mockExecute.mock.calls[0][0]).toContain('--tomorrow');
    });

    it('passes --days N', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarAgendaResponse));
      await calendarPatch.customHandlers!.agenda({ days: 3 }, 'user@test.com');

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('--days');
      expect(args).toContain('3');
    });

    it('passes --calendar filter', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarAgendaResponse));
      await calendarPatch.customHandlers!.agenda({ calendarId: 'work@test.com' }, 'user@test.com');

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('--calendar');
      expect(args).toContain('work@test.com');
    });

    it('includes calendarId in event refs', async () => {
      const response = {
        events: [{ id: 'evt-1', summary: 'Meeting', calendarId: 'shared@test.com' }],
      };
      mockExecute.mockResolvedValue(mockGwsResponse(response));
      const result = await calendarPatch.customHandlers!.agenda({}, 'user@test.com');

      const events = result.refs.events as Array<{ id: string; calendarId: string }>;
      expect(events[0]).toEqual({ id: 'evt-1', calendarId: 'shared@test.com' });
    });

    it('falls back to organizer email when calendarId missing', async () => {
      const response = {
        events: [{ id: 'evt-1', summary: 'Meeting', organizer: { email: 'owner@test.com' } }],
      };
      mockExecute.mockResolvedValue(mockGwsResponse(response));
      const result = await calendarPatch.customHandlers!.agenda({}, 'user@test.com');

      const events = result.refs.events as Array<{ id: string; calendarId: string }>;
      expect(events[0].calendarId).toBe('owner@test.com');
    });
  });

  describe('freebusy custom handler', () => {
    it('requires timeMin and timeMax', async () => {
      await expect(
        calendarPatch.customHandlers!.freebusy({ timeMax: 'Y' }, 'user@test.com'),
      ).rejects.toThrow('timeMin');
      await expect(
        calendarPatch.customHandlers!.freebusy({ timeMin: 'X' }, 'user@test.com'),
      ).rejects.toThrow('timeMax');
    });

    it('sends POST body via --json with own calendar', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyResponse));
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: '2026-04-09T08:00:00Z', timeMax: '2026-04-09T17:00:00Z' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      expect(args.slice(0, 3)).toEqual(['calendar', 'freebusy', 'query']);
      expect(args).toContain('--json');
      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      expect(body).toEqual({
        timeMin: '2026-04-09T08:00:00Z',
        timeMax: '2026-04-09T17:00:00Z',
        items: [{ id: 'user@test.com' }],
      });
    });

    it('does not use --params (the original bug)', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyResponse));
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y' },
        'user@test.com',
      );

      expect(mockExecute.mock.calls[0][0]).not.toContain('--params');
    });

    it('includes attendees in items', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyResponse));
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y', attendees: 'colleague@test.com, other@test.com' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      expect(body.items).toEqual([
        { id: 'user@test.com' },
        { id: 'colleague@test.com' },
        { id: 'other@test.com' },
      ]);
    });

    it('deduplicates own email from attendees', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyResponse));
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y', attendees: 'user@test.com, colleague@test.com' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      expect(body.items).toEqual([
        { id: 'user@test.com' },
        { id: 'colleague@test.com' },
      ]);
    });

    it('deduplicates across attendees and calendarId params', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyResponse));
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y', attendees: 'a@test.com', calendarId: 'a@test.com, b@test.com' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      expect(body.items).toEqual([
        { id: 'user@test.com' },
        { id: 'a@test.com' },
        { id: 'b@test.com' },
      ]);
    });

    it('formats busy blocks with human-readable times', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyResponse));
      const result = await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y' },
        'user@test.com',
      );

      expect(result.text).toContain('## Availability');
      expect(result.text).toContain('user@test.com');
      expect(result.text).toContain('2 busy blocks');
      expect(result.text).toContain('colleague@test.com');
      expect(result.text).toContain('Free for entire range');
    });

    it('populates busyBlocks in refs', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyResponse));
      const result = await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y' },
        'user@test.com',
      );

      const busy = result.refs.busyBlocks as Array<{ calendar: string }>;
      expect(busy).toHaveLength(2);
      expect(busy[0].calendar).toBe('user@test.com');
    });

    it('surfaces API errors per calendar instead of showing Free', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarFreeBusyErrorResponse));
      const result = await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y' },
        'user@test.com',
      );

      expect(result.text).toContain('Unable to check (notFound)');
      expect(result.text).not.toContain('private@test.com**: Free');
    });
  });

  describe('create custom handler', () => {
    it('passes --meet flag when meet: true', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      const result = await calendarPatch.customHandlers!.create(
        { summary: 'Meeting', start: 'X', end: 'Y', meet: true },
        'user@test.com',
      );

      expect(mockExecute.mock.calls[0][0]).toContain('--meet');
      expect(result.text).toContain('with Google Meet');
    });

    it('omits --meet flag when meet is false/undefined', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      await calendarPatch.customHandlers!.create(
        { summary: 'Meeting', start: 'X', end: 'Y' },
        'user@test.com',
      );

      expect(mockExecute.mock.calls[0][0]).not.toContain('--meet');
    });

    it('includes calendarId in refs', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      const result = await calendarPatch.customHandlers!.create(
        { summary: 'X', start: 'Y', end: 'Z', calendarId: 'shared@test.com' },
        'user@test.com',
      );

      expect(result.refs.calendarId).toBe('shared@test.com');
      expect(result.text).toContain('**Calendar:** shared@test.com');
    });

    it('defaults calendarId to primary', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      const result = await calendarPatch.customHandlers!.create(
        { summary: 'X', start: 'Y', end: 'Z' },
        'user@test.com',
      );

      expect(result.refs.calendarId).toBe('primary');
    });
  });
});
