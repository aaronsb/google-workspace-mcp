import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAccountManager } from '../accounts/index.js';
import {
  GetEventsParams,
  CreateEventParams,
  EventResponse,
  CreateEventResponse,
  CalendarError,
  CalendarModuleConfig
} from './types.js';

/**
 * Google Calendar Service Implementation
 * 
 * This service provides core calendar functionality including:
 * - Event retrieval with search and filtering
 * - Single event lookup
 * - Event creation with attendee management
 * 
 * The implementation follows the same pattern as GmailService for consistency,
 * using the Google Calendar API v3 for all operations.
 */
export class CalendarService {
  private oauth2Client!: OAuth2Client;

  constructor(config?: CalendarModuleConfig) {
    // No longer need to store scopes as they're managed by the registry
  }

  /**
   * Initialize the Calendar service
   * Must be called before using any calendar operations
   * Sets up OAuth client using the account manager
   */
  async initialize(): Promise<void> {
    const accountManager = getAccountManager();
    this.oauth2Client = await accountManager.getAuthClient();
  }

  /**
   * Get an authenticated Google Calendar API client
   */
  private async getCalendarClient(email: string) {
    const accountManager = getAccountManager();
    try {
      const tokenStatus = await accountManager.validateToken(email);
      if (!tokenStatus.valid || !tokenStatus.token) {
        throw new CalendarError(
          'Calendar authentication required',
          'AUTH_REQUIRED',
          'Please authenticate to access calendar'
        );
      }

      this.oauth2Client.setCredentials(tokenStatus.token);
      return google.calendar({ version: 'v3', auth: this.oauth2Client });
    } catch (error) {
      if (error instanceof CalendarError) {
        throw error;
      }
      throw new CalendarError(
        'Failed to initialize Calendar client',
        'AUTH_ERROR',
        'Please try again or contact support if the issue persists'
      );
    }
  }

  /**
   * Handle Calendar operations with automatic token refresh on 401/403
   */
  private async handleCalendarOperation<T>(email: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      // Handle 401/403 errors by attempting token refresh
      if (error.code === 401 || error.code === 403) {
        const accountManager = getAccountManager();
        const tokenStatus = await accountManager.validateToken(email);
        if (tokenStatus.valid && tokenStatus.token) {
          this.oauth2Client.setCredentials(tokenStatus.token);
          return await operation();
        }
      }
      throw error;
    }
  }

  /**
   * Retrieve calendar events with optional filtering
   * 
   * @param params.email - Email address of the calendar owner
   * @param params.query - Optional text search within events
   * @param params.maxResults - Maximum number of events to return (default: 10)
   * @param params.timeMin - Start of time range to search
   * @param params.timeMax - End of time range to search
   * @returns Array of calendar events matching the criteria
   * @throws CalendarError on API errors or authentication issues
   */
  async getEvents({ email, query, maxResults = 10, timeMin, timeMax }: GetEventsParams): Promise<EventResponse[]> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
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
        try {
          const date = new Date(timeMin);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
          params.timeMin = date.toISOString();
        } catch (error) {
          throw new CalendarError(
            'Invalid date format',
            'INVALID_DATE',
            'Please provide dates in ISO format or YYYY-MM-DD format'
          );
        }
      }

      if (timeMax) {
        try {
          const date = new Date(timeMax);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
          params.timeMax = date.toISOString();
        } catch (error) {
          throw new CalendarError(
            'Invalid date format',
            'INVALID_DATE',
            'Please provide dates in ISO format or YYYY-MM-DD format'
          );
        }
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
    });
  }

  /**
   * Retrieve a single calendar event by ID
   * 
   * @param email - Email address of the calendar owner
   * @param eventId - Unique identifier of the event to retrieve
   * @returns Detailed event information
   * @throws CalendarError if event not found or on API errors
   */
  async getEvent(email: string, eventId: string): Promise<EventResponse> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
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
    });
  }

  /**
   * Create a new calendar event
   * 
   * @param params.email - Email address of the calendar owner
   * @param params.summary - Event title
   * @param params.description - Optional event description
   * @param params.start - Event start time and timezone
   * @param params.end - Event end time and timezone
   * @param params.attendees - Optional list of event attendees
   * @returns Created event details including view link
   * @throws CalendarError on creation failure or API errors
   * 
   * Note: This method automatically sends email notifications to attendees
   */
  async createEvent({ email, summary, description, start, end, attendees }: CreateEventParams): Promise<CreateEventResponse> {
    const calendar = await this.getCalendarClient(email);

    return this.handleCalendarOperation(email, async () => {
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
    });
  }
}
