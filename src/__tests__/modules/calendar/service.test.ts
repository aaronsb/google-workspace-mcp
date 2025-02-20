import { CalendarService } from '../../../modules/calendar/service.js';
import { calendar_v3 } from 'googleapis';
import { getAccountManager } from '../../../modules/accounts/index.js';
import { AccountManager } from '../../../modules/accounts/manager.js';
import { CreateEventParams } from '../../../modules/calendar/types.js';

jest.mock('../../../modules/accounts/index.js');
jest.mock('../../../modules/accounts/manager.js');

describe('CalendarService', () => {
  let calendarService: CalendarService;
  let mockCalendarClient: jest.Mocked<calendar_v3.Calendar>;
  let mockAccountManager: jest.Mocked<AccountManager>;
  const mockEmail = 'test@example.com';

  beforeEach(() => {
    // Simplified mock setup with proper typing
    mockCalendarClient = {
      events: {
        list: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
        get: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
        insert: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
        patch: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
      },
    } as unknown as jest.Mocked<calendar_v3.Calendar>;

    mockAccountManager = {
      validateToken: jest.fn().mockResolvedValue({ valid: true, token: {} }),
      getAuthClient: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AccountManager>;

    (getAccountManager as jest.Mock).mockReturnValue(mockAccountManager);
    calendarService = new CalendarService();
    (calendarService as any).getCalendarClient = jest.fn().mockResolvedValue(mockCalendarClient);
  });

  describe('getEvents', () => {
    it('should return events list', async () => {
      const mockEvents = [
        { id: 'event1', summary: 'Test Event 1' },
        { id: 'event2', summary: 'Test Event 2' }
      ];
      
      (mockCalendarClient.events.list as jest.Mock).mockImplementation(() => 
        Promise.resolve({ data: { items: mockEvents } })
      );

      const result = await calendarService.getEvents({ email: mockEmail });

      expect(result).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'event1' }),
        expect.objectContaining({ id: 'event2' })
      ]));
    });

    it('should handle empty results', async () => {
      (mockCalendarClient.events.list as jest.Mock).mockImplementation(() => 
        Promise.resolve({ data: {} })
      );
      const result = await calendarService.getEvents({ email: mockEmail });
      expect(result).toEqual([]);
    });

    it('should handle invalid date format', async () => {
      await expect(calendarService.getEvents({
        email: mockEmail,
        timeMin: 'invalid-date'
      })).rejects.toThrow('Invalid date format');
    });
  });

  describe('createEvent', () => {
    const mockEvent = {
      email: mockEmail,
      summary: 'Meeting',
      start: { dateTime: '2024-01-15T10:00:00Z' },
      end: { dateTime: '2024-01-15T11:00:00Z' }
    };

    it('should create event', async () => {
      (mockCalendarClient.events.insert as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: { id: 'new-1', summary: 'Meeting', htmlLink: 'url' }
        })
      );

      const result = await calendarService.createEvent(mockEvent);

      expect(result).toEqual(expect.objectContaining({
        id: 'new-1',
        summary: 'Meeting'
      }));
    });

    it('should handle creation failure', async () => {
      (mockCalendarClient.events.insert as jest.Mock).mockImplementation(() =>
        Promise.reject(new Error('Failed'))
      );
      await expect(calendarService.createEvent(mockEvent)).rejects.toThrow();
    });
  });

  describe('manageEvent', () => {
    beforeEach(() => {
      (mockCalendarClient.events.get as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: {
            id: 'event1',
            summary: 'Test Event',
            attendees: [{ email: mockEmail }]
          }
        })
      );
    });

    it('should accept event', async () => {
      (mockCalendarClient.events.patch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: { id: 'event1', status: 'accepted' }
        })
      );

      const result = await calendarService.manageEvent({
        email: mockEmail,
        eventId: 'event1',
        action: 'accept'
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
    });

    it('should handle invalid action', async () => {
      await expect(calendarService.manageEvent({
        email: mockEmail,
        eventId: 'event1',
        action: 'invalid_action' as any
      })).rejects.toThrow();
    });

    it('should validate new times for propose action', async () => {
      await expect(calendarService.manageEvent({
        email: mockEmail,
        eventId: 'event1',
        action: 'propose_new_time'
      })).rejects.toThrow('No proposed times provided');
    });
  });

  describe('getEvent', () => {
    it('should get single event', async () => {
      (mockCalendarClient.events.get as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: { id: 'event1', summary: 'Test' }
        })
      );

      const result = await calendarService.getEvent(mockEmail, 'event1');
      expect(result).toEqual(expect.objectContaining({ id: 'event1' }));
    });

    it('should handle not found', async () => {
      (mockCalendarClient.events.get as jest.Mock).mockImplementation(() =>
        Promise.reject(new Error('Not found'))
      );
      await expect(calendarService.getEvent(mockEmail, 'nonexistent'))
        .rejects.toThrow();
    });
  });
});
