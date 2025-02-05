import { google } from 'googleapis';
import { BaseGoogleService, GoogleServiceError } from '../base/BaseGoogleService.js';
import {
  GetEventsParams,
  CreateEventParams,
  EventResponse,
  CreateEventResponse,
  CalendarModuleConfig
} from '../../modules/calendar/types.js';

/**
 * Google Calendar Service Implementation extending BaseGoogleService.
 * Provides calendar functionality while leveraging common Google API patterns.
 */
export class CalendarService extends BaseGoogleService<ReturnType<typeof google.calendar>> {
  constructor(config?: CalendarModuleConfig) {
    super({
      serviceName: 'calendar',
      version: 'v3'
    });
  }

  /**
   * Get an authenticated Calendar client
   */
  private async getCalendarClient(email: string) {
    return this.getAuthenticatedClient(
      email,
      (auth) => google.calendar({ version: 'v3', auth })
    );
  }

  /**
   * Retrieve calendar events with optional filtering
   */
  async getEvents({ email, query, maxResults = 10, timeMin, timeMax }: GetEventsParams): Promise<EventResponse[]> {
    try {
      const calendar = await this.getCalendarClient(email);

      // Prepare search parameters
      const params: any = {
        calendarId: 'primary',
        maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      };

      if (query) {
        params.q = query;
      }

      if (timeMin) {
        params.timeMin = new Date(timeMin).toISOString();
      }

      if (timeMax) {
        params.timeMax = new Date(timeMax).toISOString();
      }

      // List events matching criteria
      const { data } = await calendar.events.list(params);

      if (!data.items || data.items.length === 0) {
        return [];
      }

      // Map response to our EventResponse type
      return data.items.map(event => ({
        id: event.id!,
        summary: event.summary || '',
        description: event.description || undefined,
        start: {
          dateTime: event.start?.dateTime || event.start?.date || '',
          timeZone: event.start?.timeZone || 'UTC'
        },
        end: {
          dateTime: event.end?.dateTime || event.end?.date || '',
          timeZone: event.end?.timeZone || 'UTC'
        },
        attendees: event.attendees?.map(attendee => ({
          email: attendee.email!,
          responseStatus: attendee.responseStatus || undefined
        })),
        organizer: event.organizer ? {
          email: event.organizer.email!,
          self: event.organizer.self || false
        } : undefined
      }));
    } catch (error) {
      throw this.handleError(error, 'Failed to get events');
    }
  }

  /**
   * Retrieve a single calendar event by ID
   */
  async getEvent(email: string, eventId: string): Promise<EventResponse> {
    try {
      const calendar = await this.getCalendarClient(email);

      const { data: event } = await calendar.events.get({
        calendarId: 'primary',
        eventId
      });

      if (!event) {
        throw new GoogleServiceError(
          'Event not found',
          'NOT_FOUND',
          `No event found with ID: ${eventId}`
        );
      }

      return {
        id: event.id!,
        summary: event.summary || '',
        description: event.description || undefined,
        start: {
          dateTime: event.start?.dateTime || event.start?.date || '',
          timeZone: event.start?.timeZone || 'UTC'
        },
        end: {
          dateTime: event.end?.dateTime || event.end?.date || '',
          timeZone: event.end?.timeZone || 'UTC'
        },
        attendees: event.attendees?.map(attendee => ({
          email: attendee.email!,
          responseStatus: attendee.responseStatus || undefined
        })),
        organizer: event.organizer ? {
          email: event.organizer.email!,
          self: event.organizer.self || false
        } : undefined
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to get event');
    }
  }

  /**
   * Create a new calendar event
   */
  async createEvent({ email, summary, description, start, end, attendees }: CreateEventParams): Promise<CreateEventResponse> {
    try {
      const calendar = await this.getCalendarClient(email);

      const eventData = {
        summary,
        description,
        start,
        end,
        attendees: attendees?.map(attendee => ({ email: attendee.email }))
      };

      const { data: event } = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventData,
        sendUpdates: 'all'  // Send emails to attendees
      });

      if (!event.id || !event.summary) {
        throw new GoogleServiceError(
          'Failed to create event',
          'CREATE_ERROR',
          'Event creation response was incomplete'
        );
      }

      return {
        id: event.id,
        summary: event.summary,
        htmlLink: event.htmlLink || ''
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to create event');
    }
  }
}
