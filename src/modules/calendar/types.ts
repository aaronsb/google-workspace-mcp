import { AttachmentMetadata } from '../attachments/types.js';

export interface CalendarModuleConfig {
  maxAttachmentSize?: number;
  allowedAttachmentTypes?: string[];
}

export interface CalendarError {
  message: string;
  code: string;
  details?: string;
}

export interface EventTime {
  dateTime: string;
  timeZone?: string;
}

export interface EventAttendee {
  email: string;
  responseStatus?: string;
}

export interface EventOrganizer {
  email: string;
  self: boolean;
}

export interface EventResponse {
  id: string;
  summary: string;
  description?: string;
  start: EventTime;
  end: EventTime;
  attendees?: EventAttendee[];
  organizer?: EventOrganizer;
  attachments?: AttachmentMetadata[];
}

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
  start: EventTime;
  end: EventTime;
  attendees?: {
    email: string;
  }[];
  attachments?: {
    driveFileId?: string;  // For existing Drive files
    content?: string;      // Base64 content for new files
    name: string;
    mimeType: string;
    size?: number;
  }[];
}

export interface CreateEventResponse {
  id: string;
  summary: string;
  htmlLink: string;
  attachments?: AttachmentMetadata[];
}

export interface ManageEventParams {
  email: string;
  eventId: string;
  action: 'accept' | 'decline' | 'tentative' | 'propose_new_time' | 'update_time';
  comment?: string;
  newTimes?: {
    start: EventTime;
    end: EventTime;
  }[];
}

export interface ManageEventResponse {
  success: boolean;
  eventId: string;
  action: string;
  status: 'completed' | 'proposed' | 'updated';
  htmlLink?: string;
  proposedTimes?: {
    start: EventTime;
    end: EventTime;
  }[];
}

export class CalendarError extends Error {
  code: string;
  details?: string;

  constructor(message: string, code: string, details?: string) {
    super(message);
    this.name = 'CalendarError';
    this.code = code;
    this.details = details;
  }
}
