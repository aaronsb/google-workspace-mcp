export interface SearchCriteria {
  from?: string | string[];     // Support multiple senders
  to?: string | string[];       // Support multiple recipients
  subject?: string;             // Search in subject
  content?: string;             // Search in email body
  after?: string;               // Date range start (ISO string)
  before?: string;              // Date range end (ISO string)
  hasAttachment?: boolean;      // Filter emails with attachments
  labels?: string[];            // Support multiple labels
  excludeLabels?: string[];     // Labels to exclude
  includeSpam?: boolean;        // Include spam/trash
  isUnread?: boolean;           // Filter by read/unread status
}

export interface SearchOptions {
  maxResults?: number;
  pageToken?: string;           // For pagination
  includeHeaders?: boolean;     // Include all email headers
  format?: 'full' | 'metadata' | 'minimal';
  threadedView?: boolean;       // Group by conversation
  sortOrder?: 'asc' | 'desc';   // Control result ordering
}

export interface GetEmailsParams {
  email: string;
  search?: SearchCriteria;
  options?: SearchOptions;
  messageIds?: string[]; // For directly fetching specific emails
}

export interface ThreadInfo {
  messages: string[];        // Message IDs in thread
  participants: string[];    // Unique email addresses
  subject: string;
  lastUpdated: string;
}

export interface SearchResultSummary {
  total: number;
  returned: number;
  hasMore: boolean;
  searchCriteria: SearchCriteria;
}

export interface SendEmailParams {
  email: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
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
  headers?: { [key: string]: string };  // Optional full headers
  isUnread?: boolean;
  hasAttachment?: boolean;
}

export interface GetEmailsResponse {
  emails: EmailResponse[];
  nextPageToken?: string;
  resultSummary: SearchResultSummary;
  threads?: { [threadId: string]: ThreadInfo };
}

export interface SendEmailResponse {
  messageId: string;
  threadId: string;
  labelIds?: string[];
}

export interface DraftEmailParams {
  email: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  replyToMessageId?: string;  // ID of message being replied to
  threadId?: string;          // Thread ID for the reply
  references?: string[];      // Message IDs being referenced (for reply chains)
  inReplyTo?: string;        // Message ID being directly replied to
}

export interface GetDraftsParams {
  email: string;
  maxResults?: number;
  pageToken?: string;
}

export interface DraftResponse {
  id: string;
  message: EmailResponse;
  updated: string;
}

export interface GetDraftsResponse {
  drafts: DraftResponse[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface SendDraftParams {
  email: string;
  draftId: string;
}

export interface GmailProfileData {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailSettings {
  autoForwarding: {
    enabled: boolean;
    emailAddress?: string;
    disposition?: string;
  };
  imap: {
    enabled: boolean;
    autoExpunge?: boolean;
    expungeBehavior?: string;
    maxFolderSize?: number;
  };
  language: {
    displayLanguage: string;
  };
  pop: {
    enabled: boolean;
    accessWindow?: string;
    disposition?: string;
  };
  vacationResponder: {
    enabled: boolean;
    startTime?: string;
    endTime?: string;
    message?: string;
    responseSubject?: string;
  };
}

export interface GetGmailSettingsParams {
  email: string;
}

export interface GetGmailSettingsResponse {
  profile: GmailProfileData;
  settings: GmailSettings;
}

export interface GmailModuleConfig {
  requiredScopes?: string[];
}

export interface Label {
  id: string;
  name: string;
  type: 'system' | 'user';
  messageListVisibility?: 'hide' | 'show';
  labelListVisibility?: 'labelHide' | 'labelShow' | 'labelShowIfUnread';
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface CreateLabelParams {
  email: string;
  name: string;
  messageListVisibility?: 'hide' | 'show';
  labelListVisibility?: 'labelHide' | 'labelShow' | 'labelShowIfUnread';
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface UpdateLabelParams {
  email: string;
  labelId: string;
  name?: string;
  messageListVisibility?: 'hide' | 'show';
  labelListVisibility?: 'labelHide' | 'labelShow' | 'labelShowIfUnread';
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface DeleteLabelParams {
  email: string;
  labelId: string;
}

export interface GetLabelsParams {
  email: string;
}

export interface GetLabelsResponse {
  labels: Label[];
}

export interface ModifyMessageLabelsParams {
  email: string;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export class GmailError extends Error {
  constructor(
    message: string,
    public code: string,
    public resolution: string
  ) {
    super(message);
    this.name = 'GmailError';
  }
}
