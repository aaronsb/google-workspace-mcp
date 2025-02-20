import { AttachmentMetadata } from '../attachments/types.js';

export interface GmailError {
  message: string;
  code: string;
  details?: string;
}

export interface SearchCriteria {
  from?: string | string[];
  to?: string | string[];
  subject?: string;
  after?: string;
  before?: string;
  hasAttachment?: boolean;
  labels?: string[];
  excludeLabels?: string[];
  includeSpam?: boolean;
  isUnread?: boolean;
}

export interface EmailResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  headers?: { [key: string]: string };
  isUnread: boolean;
  hasAttachment: boolean;
  attachments?: AttachmentMetadata[];
}

export interface ThreadInfo {
  messages: string[];
  participants: string[];
  subject: string;
  lastUpdated: string;
}

export interface GetEmailsParams {
  search?: SearchCriteria;
  options?: {
    maxResults?: number;
    pageToken?: string;
    format?: 'full' | 'metadata' | 'minimal';
    includeHeaders?: boolean;
    threadedView?: boolean;
    sortOrder?: 'asc' | 'desc';
  };
  messageIds?: string[];
}

export interface GetEmailsResponse {
  emails: EmailResponse[];
  nextPageToken?: string;
  resultSummary: {
    total: number;
    returned: number;
    hasMore: boolean;
    searchCriteria: SearchCriteria;
  };
  threads?: { [threadId: string]: ThreadInfo };
}

export interface SendEmailParams {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  attachments?: {
    driveFileId?: string;  // For existing Drive files
    content?: string;      // Base64 content for new files
    name: string;
    mimeType: string;
    size?: number;
  }[];
}

export interface SendEmailResponse {
  messageId: string;
  threadId: string;
  labelIds?: string[];
  attachments?: AttachmentMetadata[];
}

export class GmailError extends Error {
  code: string;
  details?: string;

  constructor(message: string, code: string, details?: string) {
    super(message);
    this.name = 'GmailError';
    this.code = code;
    this.details = details;
  }
}
