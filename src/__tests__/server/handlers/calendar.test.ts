import {
  mockExecute, mockGwsResponse,
  calendarAgendaResponse, calendarEventsListResponse, calendarEventDetailResponse, calendarInsertResponse,
} from './__mocks__/executor.js';
import { handleCalendar } from '../../../server/handlers/calendar.js';

describe('handleCalendar', () => {
  beforeEach(() => mockExecute.mockReset());

  it('rejects missing email', async () => {
    await expect(handleCalendar({ operation: 'list' })).rejects.toThrow('valid email');
  });

  describe('list', () => {
    it('returns formatted events', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarEventsListResponse));
      const result = await handleCalendar({ operation: 'list', email: 'user@test.com' }) as any;

      expect(result.events).toHaveLength(2);
      expect(result.events[0].summary).toBe('Standup');
      expect(result.next_steps).toBeDefined();
    });

    it('defaults timeMin to today', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarEventsListResponse));
      await handleCalendar({ operation: 'list', email: 'user@test.com' });

      const args = mockExecute.mock.calls[0][0];
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.timeMin).toBeDefined();
      expect(params.singleEvents).toBe(true);
    });

    it('clamps maxResults to 50', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarEventsListResponse));
      await handleCalendar({ operation: 'list', email: 'user@test.com', maxResults: 100 });

      const args = mockExecute.mock.calls[0][0];
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.maxResults).toBe(50);
    });
  });

  describe('agenda', () => {
    it('calls gws calendar +agenda', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarAgendaResponse));
      const result = await handleCalendar({ operation: 'agenda', email: 'user@test.com' }) as any;

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
      expect(args).toContain('--attendees');
    });

    it('omits optional fields when absent', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarInsertResponse));
      await handleCalendar({
        operation: 'create', email: 'user@test.com',
        summary: 'Meeting', start: 'X', end: 'Y',
      });

      const args = mockExecute.mock.calls[0][0];
      expect(args).not.toContain('--location');
      expect(args).not.toContain('--attendees');
    });
  });

  describe('get', () => {
    it('requires eventId', async () => {
      await expect(handleCalendar({ operation: 'get', email: 'user@test.com' })).rejects.toThrow('eventId');
    });

    it('returns formatted event detail', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(calendarEventDetailResponse));
      const result = await handleCalendar({ operation: 'get', email: 'user@test.com', eventId: 'evt-1' }) as any;

      expect(result.summary).toBe('Standup');
      expect(result.attendees).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('requires eventId', async () => {
      await expect(handleCalendar({ operation: 'delete', email: 'user@test.com' })).rejects.toThrow('eventId');
    });

    it('returns deleted status', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse({}));
      const result = await handleCalendar({ operation: 'delete', email: 'user@test.com', eventId: 'evt-1' }) as any;

      expect(result.status).toBe('deleted');
      expect(result.eventId).toBe('evt-1');
    });
  });

  it('rejects unknown operation', async () => {
    await expect(handleCalendar({ operation: 'nope', email: 'user@test.com' })).rejects.toThrow('Unknown');
  });
});
