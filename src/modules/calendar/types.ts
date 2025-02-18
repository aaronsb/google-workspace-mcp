/**
 * Calendar Module Type Definitions
 * This file contains all type definitions for the Calendar module, following
 * the same pattern as the Gmail module for consistency across services.
 */

/**
 * Parameters for retrieving calendar events
 * @property email - The email address of the authenticated account
 * @property query - Optional text query to search events (searches in title, description, attendees)
 * @property maxResults - Maximum number of events to return (default: 10)
 * @property timeMin - Start of the time range to search (ISO string)
 * @property timeMax - End of the time range to search (ISO string)
 */
export interface GetEventsParams {
  email: string;
  query?: string;
  maxResults?: number;
  timeMin?: string;
  timeMax?: string;
}

/**
 * Parameters for creating a new calendar event
 * @property email - The email address of the authenticated account
 * @property summary - Event title/summary
 * @property description - Optional detailed description of the event
 * @property start - Event start time with optional timezone
 * @property end - Event end time with optional timezone
 * @property attendees - Optional list of event attendees
 */
export interface CreateEventParams {
  email: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  attendees?: { email: string }[];
}

/**
 * Response structure for calendar events
 * Contains all relevant event information including timing,
 * attendees, and organizer details.
 */
export interface EventResponse {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees?: {
    email: string;
    responseStatus?: string;
  }[];
  organizer?: {
    email: string;
    self?: boolean;
  };
}

/**
 * Response structure for event creation
 * @property id - Unique identifier for the created event
 * @property summary - Event title/summary
 * @property htmlLink - URL to view the event in Google Calendar
 */
export interface CreateEventResponse {
  id: string;
  summary: string;
  htmlLink: string;
}

/**
 * Configuration options for the Calendar module
 * @property requiredScopes - Optional override for OAuth scopes
 * Default scopes are defined in common/scopes.ts
 */
/**
 * Parameters for managing calendar event responses and updates
 */
export interface ManageEventParams {
  email: string;
  eventId: string;
  action: 'accept' | 'decline' | 'tentative' | 'propose_new_time' | 'update_time';
  comment?: string;
  newTimes?: Array<{
    start: { dateTime: string; timeZone?: string };
    end: { dateTime: string; timeZone?: string };
  }>;
}

/**
 * Response structure for event management actions
 */
export interface ManageEventResponse {
  success: boolean;
  eventId: string;
  action: string;
  status: string;
  htmlLink?: string;
  proposedTimes?: Array<{
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
  }>;
}

export interface CalendarModuleConfig {
  requiredScopes?: string[];
}

/**
 * Custom error class for Calendar-specific errors
 * Follows the same pattern as GmailError for consistent error handling
 * across modules.
 */
export class CalendarError extends Error {
  constructor(
    message: string,
    public code: string,
    public resolution: string
  ) {
    super(message);
    this.name = 'CalendarError';
  }
}
