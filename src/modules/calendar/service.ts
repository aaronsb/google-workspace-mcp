import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAccountManager } from '../accounts/index.js';
import {
  GetEventsParams,
  CreateEventParams,
  EventResponse,
  CreateEventResponse,
  CalendarError,
  DEFAULT_CALENDAR_SCOPES,
  CalendarModuleConfig
} from './types.js';

export class CalendarService {
  private oauth2Client!: OAuth2Client;
  private requiredScopes: string[];

  constructor(config?: CalendarModuleConfig) {
    this.requiredScopes = config?.requiredScopes || DEFAULT_CALENDAR_SCOPES;
  }

  async initialize(): Promise<void> {
    const accountManager = getAccountManager();
    this.oauth2Client = await accountManager.getAuthClient();
  }

  private async getCalendarClient(email: string) {
    const accountManager = getAccountManager();
    
    // Get token for the email
    const tokenStatus = await accountManager.validateToken(email, this.requiredScopes);

    if (!tokenStatus.valid || !tokenStatus.token) {
      throw new CalendarError(
        'Calendar authentication required',
        'AUTH_REQUIRED',
        'Please authenticate the account with Calendar scopes'
      );
    }

    // Set credentials on the OAuth client
    this.oauth2Client.setCredentials(tokenStatus.token);
    return google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

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
      if (error instanceof CalendarError) {
        throw error;
      }
      throw new CalendarError(
        'Failed to get events',
        'FETCH_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getEvent(email: string, eventId: string): Promise<EventResponse> {
    try {
      const calendar = await this.getCalendarClient(email);

      const { data: event } = await calendar.events.get({
        calendarId: 'primary',
        eventId
      });

      if (!event) {
        throw new CalendarError(
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
      if (error instanceof CalendarError) {
        throw error;
      }
      throw new CalendarError(
        'Failed to get event',
        'FETCH_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

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
        throw new CalendarError(
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
      if (error instanceof CalendarError) {
        throw error;
      }
      throw new CalendarError(
        'Failed to create event',
        'CREATE_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
