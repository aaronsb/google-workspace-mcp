import { vi } from 'vitest';

// Registered here, not in the shared helper: vi.mock hoists per-file.
// BOTH seams are mocked (ADR-103): `freebusy`, `update` and `delete` are
// RESOURCE ops and go through the client we own; `agenda` and `create` are still
// gws HELPERS (+agenda / +insert) and go through execute().
vi.mock('../../executor/gws.js');
vi.mock('../../google/client.js');
/**
 * Tests for the calendar service patch — custom handlers and formatters
 * that extend the factory-generated handler.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { mockExecute, mockGwsResponse, calendarAgendaResponse } from '../server/handlers/__mocks__/executor.js';
import { mockCall } from '../server/handlers/__mocks__/client.js';
import {
  calendarEventsListResponse, calendarInsertResponse,
  calendarFreeBusyResponse, calendarFreeBusyErrorResponse,
} from '../server/handlers/__mocks__/fixtures.js';
import { requestFor, queryOf } from '../support/request.js';
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
  beforeEach(() => {
    mockExecute.mockReset();
    mockCall.mockReset();
  });

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

  describe('beforeExecute.list', () => {
    // The hook used to do JSON surgery on a `--params` argv slot. It now takes
    // the params themselves, so the assertion looks at the params.
    it('defaults timeMin to the start of today when the caller gave none', async () => {
      const params = await calendarPatch.beforeExecute!.list({ calendarId: 'primary' }, ctx());
      expect(typeof params.timeMin).toBe('string');
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      expect(params.timeMin).toBe(todayStart);
      expect(params.calendarId).toBe('primary'); // untouched params survive
    });

    it('leaves an explicit timeMin alone', async () => {
      const params = await calendarPatch.beforeExecute!.list({ timeMin: '2026-01-01T00:00:00Z' }, ctx());
      expect(params.timeMin).toBe('2026-01-01T00:00:00Z');
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
      expect(mockCall).not.toHaveBeenCalled();
    });

    it('sends the whole query as the POST body, with own calendar in items', async () => {
      mockCall.mockResolvedValue(calendarFreeBusyResponse);
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: '2026-04-09T08:00:00Z', timeMax: '2026-04-09T17:00:00Z' },
        'user@test.com',
      );

      expect(mockCall).toHaveBeenCalledWith(
        'calendar',
        'freebusy.query',
        {
          timeMin: '2026-04-09T08:00:00Z',
          timeMax: '2026-04-09T17:00:00Z',
          items: [{ id: 'user@test.com' }],
        },
        expect.objectContaining({ account: 'user@test.com' }),
      );
    });

    it('puts nothing in the query string (the original bug)', async () => {
      mockCall.mockResolvedValue(calendarFreeBusyResponse);
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y' },
        'user@test.com',
      );

      // freebusy.query declares no query params: timeMin/timeMax/items are the
      // request BODY. Passing them as query params returned an empty result.
      const request = await requestFor('calendar', 'freebusy.query', mockCall.mock.calls[0][2]);
      expect(request.method).toBe('POST');
      expect(queryOf(request)).toEqual({});
      expect(request.body).toEqual({ timeMin: 'X', timeMax: 'Y', items: [{ id: 'user@test.com' }] });
    });

    it('includes attendees in items', async () => {
      mockCall.mockResolvedValue(calendarFreeBusyResponse);
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y', attendees: 'colleague@test.com, other@test.com' },
        'user@test.com',
      );

      expect(mockCall.mock.calls[0][2].items).toEqual([
        { id: 'user@test.com' },
        { id: 'colleague@test.com' },
        { id: 'other@test.com' },
      ]);
    });

    it('deduplicates own email from attendees', async () => {
      mockCall.mockResolvedValue(calendarFreeBusyResponse);
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y', attendees: 'user@test.com, colleague@test.com' },
        'user@test.com',
      );

      expect(mockCall.mock.calls[0][2].items).toEqual([
        { id: 'user@test.com' },
        { id: 'colleague@test.com' },
      ]);
    });

    it('deduplicates across attendees and calendarId params', async () => {
      mockCall.mockResolvedValue(calendarFreeBusyResponse);
      await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y', attendees: 'a@test.com', calendarId: 'a@test.com, b@test.com' },
        'user@test.com',
      );

      expect(mockCall.mock.calls[0][2].items).toEqual([
        { id: 'user@test.com' },
        { id: 'a@test.com' },
        { id: 'b@test.com' },
      ]);
    });

    it('formats busy blocks with human-readable times', async () => {
      mockCall.mockResolvedValue(calendarFreeBusyResponse);
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
      mockCall.mockResolvedValue(calendarFreeBusyResponse);
      const result = await calendarPatch.customHandlers!.freebusy(
        { timeMin: 'X', timeMax: 'Y' },
        'user@test.com',
      );

      const busy = result.refs.busyBlocks as Array<{ calendar: string }>;
      expect(busy).toHaveLength(2);
      expect(busy[0].calendar).toBe('user@test.com');
    });

    it('surfaces API errors per calendar instead of showing Free', async () => {
      mockCall.mockResolvedValue(calendarFreeBusyErrorResponse);
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

    it('passes attendees via --attendee (singular) — gws rejects the plural form', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      await calendarPatch.customHandlers!.create(
        { summary: 'X', start: 'Y', end: 'Z', attendees: 'a@b.com,c@d.com' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('--attendee');
      expect(args).not.toContain('--attendees');
      const idx = args.indexOf('--attendee');
      expect(args[idx + 1]).toBe('a@b.com,c@d.com');
    });
  });

  describe('update custom handler', () => {
    it('requires eventId', async () => {
      await expect(
        calendarPatch.customHandlers!.update({ summary: 'X' }, 'user@test.com'),
      ).rejects.toThrow('eventId');
    });

    it('rejects updates with no fields to change', async () => {
      await expect(
        calendarPatch.customHandlers!.update({ eventId: 'evt-1' }, 'user@test.com'),
      ).rejects.toThrow('at least one field');
      expect(mockCall).not.toHaveBeenCalled();
    });

    it('routes via events.patch, with the ids in the path and the changes in the body', async () => {
      mockCall.mockResolvedValue({ id: 'evt-1', summary: 'New title' });
      await calendarPatch.customHandlers!.update(
        { eventId: 'evt-1', summary: 'New title' },
        'user@test.com',
      );

      const [service, resourcePath, params, options] = mockCall.mock.calls[0];
      expect(service).toBe('calendar');
      expect(resourcePath).toBe('events.patch');
      expect(options).toMatchObject({ account: 'user@test.com' });
      expect(params).toEqual({ calendarId: 'primary', eventId: 'evt-1', summary: 'New title' });

      // The manifest-driven path would have sent an empty body and Google would
      // have returned 200 without applying anything. Assert the split explicitly.
      const request = await requestFor('calendar', 'events.patch', params);
      expect(request.method).toBe('PATCH');
      expect(request.body).toEqual({ summary: 'New title' });
      expect(request.url).toContain('/calendars/primary/events/evt-1');
    });

    it('maps start and end to dateTime objects', async () => {
      mockCall.mockResolvedValue({ id: 'evt-1' });
      await calendarPatch.customHandlers!.update(
        { eventId: 'evt-1', start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z' },
        'user@test.com',
      );

      const body = (await requestFor('calendar', 'events.patch', mockCall.mock.calls[0][2])).body!;
      expect(body.start).toEqual({ dateTime: '2026-05-01T10:00:00Z' });
      expect(body.end).toEqual({ dateTime: '2026-05-01T11:00:00Z' });
    });

    it('converts comma-separated attendees string into array of {email}', async () => {
      mockCall.mockResolvedValue({ id: 'evt-1' });
      await calendarPatch.customHandlers!.update(
        { eventId: 'evt-1', attendees: 'a@b.com, c@d.com , e@f.com' },
        'user@test.com',
      );

      const body = (await requestFor('calendar', 'events.patch', mockCall.mock.calls[0][2])).body!;
      expect(body.attendees).toEqual([
        { email: 'a@b.com' },
        { email: 'c@d.com' },
        { email: 'e@f.com' },
      ]);
    });

    it('clears attendees when attendees is an empty string', async () => {
      mockCall.mockResolvedValue({ id: 'evt-1' });
      await calendarPatch.customHandlers!.update(
        { eventId: 'evt-1', attendees: '' },
        'user@test.com',
      );

      // An empty array is a meaningful body value (Google replaces the guest list
      // wholesale), so read it off the params — an empty array in the body would
      // otherwise be indistinguishable from "absent" only if it were dropped.
      expect(mockCall.mock.calls[0][2].attendees).toEqual([]);
      const body = (await requestFor('calendar', 'events.patch', mockCall.mock.calls[0][2])).body!;
      expect(body.attendees).toEqual([]);
    });

    it('adds conferenceData to the body + conferenceDataVersion=1 to the query when meet: true', async () => {
      mockCall.mockResolvedValue({ id: 'evt-1', hangoutLink: 'https://meet.google.com/abc' });
      await calendarPatch.customHandlers!.update(
        { eventId: 'evt-1', meet: true },
        'user@test.com',
      );

      const params = mockCall.mock.calls[0][2];
      const request = await requestFor('calendar', 'events.patch', params);
      expect(queryOf(request).conferenceDataVersion).toBe('1');
      const conferenceData = request.body!.conferenceData as Record<string, any>;
      expect(conferenceData).toBeDefined();
      expect(conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
    });

    it('honors explicit calendarId', async () => {
      mockCall.mockResolvedValue({ id: 'evt-1' });
      await calendarPatch.customHandlers!.update(
        { eventId: 'evt-1', summary: 'X', calendarId: 'shared@test.com' },
        'user@test.com',
      );

      expect(mockCall.mock.calls[0][2].calendarId).toBe('shared@test.com');
      const request = await requestFor('calendar', 'events.patch', mockCall.mock.calls[0][2]);
      expect(request.url).toContain('/calendars/shared%40test.com/events/evt-1');
    });

    it('lists changed fields in response text and refs', async () => {
      mockCall.mockResolvedValue({ id: 'evt-1', summary: 'New' });
      const result = await calendarPatch.customHandlers!.update(
        { eventId: 'evt-1', summary: 'New', location: 'Room B' },
        'user@test.com',
      );

      expect(result.text).toContain('summary');
      expect(result.text).toContain('location');
      expect(result.refs.changed).toEqual(['summary', 'location']);
    });
  });

  describe('delete custom handler', () => {
    it('routes via events.delete and reports the deletion', async () => {
      mockCall.mockResolvedValue({});
      const result = await calendarPatch.customHandlers!.delete(
        { eventId: 'evt-1' },
        'user@test.com',
      );

      expect(mockCall).toHaveBeenCalledWith(
        'calendar',
        'events.delete',
        { calendarId: 'primary', eventId: 'evt-1' },
        expect.objectContaining({ account: 'user@test.com' }),
      );
      expect(result.text).toContain('Event deleted: evt-1');
      expect(result.refs.status).toBe('deleted');
    });
  });
});
