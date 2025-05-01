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

  describe('deleteEvent', () => {
    beforeEach(() => {
      // Add delete method to mock
      mockCalendarClient.events.delete = jest.fn().mockResolvedValue({});
    });

    it('should delete a single event with default parameters', async () => {
      await calendarService.deleteEvent(mockEmail, 'event1');
      
      expect(mockCalendarClient.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event1',
        sendUpdates: 'all'
      });
    });

    it('should delete a single event with custom sendUpdates', async () => {
      await calendarService.deleteEvent(mockEmail, 'event1', 'none');
      
      expect(mockCalendarClient.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event1',
        sendUpdates: 'none'
      });
    });

    it('should delete entire series of a recurring event', async () => {
      await calendarService.deleteEvent(mockEmail, 'recurring1', 'all', 'entire_series');
      
      expect(mockCalendarClient.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'recurring1',
        sendUpdates: 'all'
      });
    });

    it('should handle "this_and_following" for a recurring event instance', async () => {
      // Mock a recurring event instance
      (mockCalendarClient.events.get as jest.Mock).mockResolvedValueOnce({
        data: {
          id: 'instance1',
          recurringEventId: 'master1',
          start: { dateTime: '2024-05-15T10:00:00Z' }
        }
      });

      // Mock the master event
      (mockCalendarClient.events.get as jest.Mock).mockResolvedValueOnce({
        data: {
          id: 'master1',
          recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
          start: { dateTime: '2024-05-01T10:00:00Z' }
        }
      });

      await calendarService.deleteEvent(mockEmail, 'instance1', 'all', 'this_and_following');
      
      // Should get the instance
      expect(mockCalendarClient.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'instance1'
      });

      // Should get the master event
      expect(mockCalendarClient.events.get).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'master1'
      });

      // Should update the master event's recurrence rule
      expect(mockCalendarClient.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          eventId: 'master1',
          requestBody: {
            recurrence: expect.arrayContaining([
              expect.stringMatching(/RRULE:FREQ=WEEKLY;COUNT=10;UNTIL=\d+/)
            ])
          }
        })
      );

      // Should delete the instance
      expect(mockCalendarClient.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'instance1',
        sendUpdates: 'all'
      });
    });

    it('should handle "this_and_following" for a master recurring event', async () => {
      // Mock a master recurring event
      (mockCalendarClient.events.get as jest.Mock).mockResolvedValueOnce({
        data: {
          id: 'master1',
          recurrence: ['RRULE:FREQ=WEEKLY;COUNT=10'],
          start: { dateTime: '2024-05-01T10:00:00Z' }
        }
      });

      await calendarService.deleteEvent(mockEmail, 'master1', 'all', 'this_and_following');
      
      // Should update the recurrence rule
      expect(mockCalendarClient.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          eventId: 'master1',
          requestBody: {
            recurrence: expect.arrayContaining([
              expect.stringMatching(/RRULE:FREQ=WEEKLY;COUNT=10;UNTIL=\d+/)
            ])
          }
        })
      );
    });

    it('should throw error when using "this_and_following" on a non-recurring event', async () => {
      // Mock a non-recurring event
      (mockCalendarClient.events.get as jest.Mock).mockResolvedValueOnce({
        data: {
          id: 'single1',
          summary: 'Single Event',
          start: { dateTime: '2024-05-01T10:00:00Z' }
        }
      });

      await expect(
        calendarService.deleteEvent(mockEmail, 'single1', 'all', 'this_and_following')
      ).rejects.toThrow('Deletion scope can only be applied to recurring events');
    });

    it('should handle errors gracefully', async () => {
      (mockCalendarClient.events.get as jest.Mock).mockRejectedValueOnce(new Error('API error'));
      (mockCalendarClient.events.delete as jest.Mock).mockResolvedValueOnce({});

      // Should fall back to simple delete
      await calendarService.deleteEvent(mockEmail, 'event1', 'all', 'this_and_following');
      
      expect(mockCalendarClient.events.delete).toHaveBeenCalledWith({
        calendarId: 'primary',
        eventId: 'event1',
        sendUpdates: 'all'
      });
    });
  });
});
