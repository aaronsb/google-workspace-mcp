import { vi, beforeEach, describe, expect, it } from 'vitest';

// Registered here, not in the shared helper: vi.mock hoists per-file.
// BOTH seams are mocked (ADR-103): `list`/`get`/`delete` are resource ops and go
// through the client; `agenda` and `create` are still gws helpers (+agenda /
// +insert) and go through execute().
vi.mock('../../../executor/gws.js');
vi.mock('../../../google/client.js');
import { mockExecute, mockGwsResponse, calendarAgendaResponse } from './__mocks__/executor.js';
import { mockCall } from './__mocks__/client.js';
import {
  calendarEventsListResponse, calendarEventDetailResponse, calendarInsertResponse,
} from './__mocks__/fixtures.js';
import { handleCalendar } from '../../../server/handlers/calendar.js';

describe('handleCalendar', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCall.mockReset();
  });

  it('rejects missing email', async () => {
    await expect(handleCalendar({ operation: 'list' })).rejects.toThrow('valid email');
  });

  describe('list', () => {
    it('returns markdown with events', async () => {
      mockCall.mockResolvedValue(calendarEventsListResponse);
      const result = await handleCalendar({ operation: 'list', email: 'user@test.com' });

      expect(result.text).toContain('## Events (2)');
      expect(result.text).toContain('Standup');
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBe(2);
    });

    it('defaults timeMin to today', async () => {
      mockCall.mockResolvedValue(calendarEventsListResponse);
      await handleCalendar({ operation: 'list', email: 'user@test.com' });

      expect(mockCall).toHaveBeenCalledWith(
        'calendar',
        'events.list',
        expect.objectContaining({ singleEvents: true }),
        expect.objectContaining({ account: 'user@test.com' }),
      );
      expect(mockCall.mock.calls[0][2].timeMin).toBeDefined();
    });

    it('clamps maxResults to 50', async () => {
      mockCall.mockResolvedValue(calendarEventsListResponse);
      await handleCalendar({ operation: 'list', email: 'user@test.com', maxResults: 100 });

      expect(mockCall.mock.calls[0][2].maxResults).toBe(50);
    });
  });

  describe('agenda', () => {
    it('calls gws calendar +agenda', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarAgendaResponse));
      await handleCalendar({ operation: 'agenda', email: 'user@test.com' });

      expect(mockExecute).toHaveBeenCalledWith(['calendar', '+agenda'], expect.objectContaining({ account: 'user@test.com' }));
    });
  });

  describe('create', () => {
    it('requires summary, start, end', async () => {
      await expect(handleCalendar({ operation: 'create', email: 'user@test.com' })).rejects.toThrow('summary');
      await expect(handleCalendar({ operation: 'create', email: 'user@test.com', summary: 'X' })).rejects.toThrow('start');
      await expect(handleCalendar({ operation: 'create', email: 'user@test.com', summary: 'X', start: 'Y' })).rejects.toThrow('end');
    });

    it('passes optional fields', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      await handleCalendar({
        operation: 'create', email: 'user@test.com',
        summary: 'Meeting', start: '2026-03-14T10:00:00Z', end: '2026-03-14T11:00:00Z',
        location: 'Room A', attendees: 'a@b.com',
      });

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('--location');
      // gws expects the singular form --attendee (the plural --attendees is rejected by the CLI).
      expect(args).toContain('--attendee');
    });

    it('returns markdown with event details', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      const result = await handleCalendar({
        operation: 'create', email: 'user@test.com',
        summary: 'Meeting', start: 'X', end: 'Y',
      });

      expect(result.text).toContain('Event created: **Meeting**');
      expect(result.refs.summary).toBe('Meeting');
    });
  });

  describe('get', () => {
    it('requires eventId', async () => {
      await expect(handleCalendar({ operation: 'get', email: 'user@test.com' })).rejects.toThrow('eventId');
    });

    it('returns markdown event detail', async () => {
      mockCall.mockResolvedValue(calendarEventDetailResponse);
      const result = await handleCalendar({ operation: 'get', email: 'user@test.com', eventId: 'evt-1' });

      expect(mockCall).toHaveBeenCalledWith(
        'calendar',
        'events.get',
        expect.objectContaining({ eventId: 'evt-1' }),
        expect.objectContaining({ account: 'user@test.com' }),
      );
      expect(result.text).toContain('## Standup');
      expect(result.text).toContain('alice@test.com');
      expect(result.refs.eventId).toBe('evt-1');
    });
  });

  describe('delete', () => {
    it('requires eventId', async () => {
      await expect(handleCalendar({ operation: 'delete', email: 'user@test.com' })).rejects.toThrow('eventId');
    });

    it('returns deleted status', async () => {
      mockCall.mockResolvedValue({});
      const result = await handleCalendar({ operation: 'delete', email: 'user@test.com', eventId: 'evt-1' });

      expect(mockCall).toHaveBeenCalledWith(
        'calendar',
        'events.delete',
        expect.objectContaining({ eventId: 'evt-1', calendarId: 'primary' }),
        expect.objectContaining({ account: 'user@test.com' }),
      );
      expect(result.text).toContain('Event deleted: evt-1');
      expect(result.refs.status).toBe('deleted');
      expect(result.refs.eventId).toBe('evt-1');
    });
  });

  it('rejects unknown operation', async () => {
    await expect(handleCalendar({ operation: 'nope', email: 'user@test.com' })).rejects.toThrow('Unknown');
  });
});
