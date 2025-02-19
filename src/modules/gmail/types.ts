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

/**
 * Label filter criteria for automatically applying labels to messages
 */
export interface LabelFilterCriteria {
  from?: string[];           // Match sender email addresses
  to?: string[];            // Match recipient email addresses
  subject?: string;         // Match text in subject
  hasWords?: string[];      // Match words in message body
  doesNotHaveWords?: string[]; // Exclude messages with these words
  hasAttachment?: boolean;  // Match messages with attachments
  size?: {
    operator: 'larger' | 'smaller';
    size: number;           // Size in bytes
  };
}

/**
 * Actions to take when filter criteria match
 */
export interface LabelFilterActions {
  addLabel: boolean;        // Apply the label
  markImportant?: boolean;  // Mark as important
  markRead?: boolean;       // Mark as read
  archive?: boolean;        // Archive the message
}

/**
 * Label filter configuration
 */
export interface LabelFilter {
  id: string;              // Unique filter ID
  labelId: string;         // ID of the label to apply
  criteria: LabelFilterCriteria;
  actions: LabelFilterActions;
}

/**
 * Parameters for creating a new label filter
 */
export interface CreateLabelFilterParams {
  email: string;
  labelId: string;
  criteria: LabelFilterCriteria;
  actions: LabelFilterActions;
}

/**
 * Parameters for updating an existing label filter
 */
export interface UpdateLabelFilterParams {
  email: string;
  filterId: string;
  labelId: string;
  criteria: LabelFilterCriteria;
  actions: LabelFilterActions;
}

/**
 * Parameters for deleting a label filter
 */
export interface DeleteLabelFilterParams {
  email: string;
  filterId: string;
}

/**
 * Parameters for getting label filters
 */
export interface GetLabelFiltersParams {
  email: string;
  labelId?: string;  // Optional: get filters for specific label
}

/**
 * Response for getting label filters
 */
export interface GetLabelFiltersResponse {
  filters: LabelFilter[];
}

// Re-export label management types
export {
  LabelAction,
  LabelAssignmentAction,
  LabelFilterAction,
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams
} from './services/label.js';

// Re-export draft management types
export {
  DraftAction,
  ManageDraftParams
} from './services/draft.js';

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
