export interface GetEventsParams {
  email: string;
  query?: string;
  maxResults?: number;
  timeMin?: string;
  timeMax?: string;
}

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

export interface CreateEventResponse {
  id: string;
  summary: string;
  htmlLink: string;
}

export interface CalendarModuleConfig {
  requiredScopes?: string[];
}

import { CALENDAR_SCOPES } from '../../common/scopes.js';

export const DEFAULT_CALENDAR_SCOPES = CALENDAR_SCOPES;

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
