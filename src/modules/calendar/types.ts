import { AttachmentMetadata } from '../attachments/types.js';
import { AttachmentInfo } from '../attachments/response-transformer.js';

export interface CalendarModuleConfig {
  maxAttachmentSize?: number;
  allowedAttachmentTypes?: string[];
}

export interface CalendarAttachment {
  content: string;      // Base64 content
  title: string;       // Filename
  mimeType: string;    // MIME type
  size?: number;       // Size in bytes
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
  attachments?: AttachmentInfo[];
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

export interface DeleteEventParams {
  email: string;
  eventId: string;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
  deletionScope?: 'entire_series' | 'this_and_following';
}

export class CalendarError extends Error implements CalendarError {
  code: string;
  details?: string;

  constructor(message: string, code: string, details?: string) {
    super(message);
    this.name = 'CalendarError';
    this.code = code;
    this.details = details;
  }
}
