/**
 * Standard response format for all MCP tools
 * @property content - Array of content blocks to return to the client
 * @property isError - Whether this response represents an error condition
 * @property _meta - Optional metadata about the response
 */
export interface McpToolResponse {
  content: {
    type: 'text';
    text: string;
  }[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * Base interface for all tool arguments
 * Provides type safety for unknown properties
 */
export interface ToolArguments {
  [key: string]: unknown;
}

/**
 * Common arguments required by all workspace tools
 * @property email - The Google Workspace account email address
 */
export interface BaseToolArguments extends Record<string, unknown> {
  email: string;
}

/**
 * Parameters for authenticating a workspace account
 * @property email - Email address to authenticate
 * @property category - Optional account category (e.g., 'work', 'personal')
 * @property description - Optional account description
 * @property auth_code - OAuth2 authorization code (required for completing auth)
 */
export interface AuthenticateAccountArgs extends BaseToolArguments {
  category?: string;
  description?: string;
  auth_code?: string;
}

// Gmail Types
/**
 * Parameters for searching Gmail messages
 * @property email - The Gmail account to search
 * @property search - Search criteria for filtering emails
 * @property options - Search options including pagination and format
 */
export interface GmailSearchParams {
  email: string;
  search?: {
    from?: string | string[];
    to?: string | string[];
    subject?: string;
    content?: string;
    after?: string; // YYYY-MM-DD
    before?: string; // YYYY-MM-DD
    hasAttachment?: boolean;
    labels?: string[]; // e.g., ["INBOX", "IMPORTANT"]
    excludeLabels?: string[];
    includeSpam?: boolean;
    isUnread?: boolean;
  };
  options?: {
    maxResults?: number;
    pageToken?: string;
    includeHeaders?: boolean;
    format?: 'full' | 'metadata' | 'minimal';
    threadedView?: boolean;
    sortOrder?: 'asc' | 'desc';
  };
}

/**
 * Content for sending or creating draft emails
 * @property to - Array of recipient email addresses
 * @property subject - Email subject line
 * @property body - Email body content (supports HTML)
 * @property cc - Optional CC recipients
 * @property bcc - Optional BCC recipients
 */
export interface EmailContent {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

/**
 * Parameters for sending emails
 */
export interface SendEmailArgs extends BaseToolArguments, EmailContent {}

/**
 * Parameters for creating draft emails
 */
export interface CreateDraftArgs extends SendEmailArgs {
  replyToMessageId?: string;
  threadId?: string;
  references?: string[];
  inReplyTo?: string;
}

/**
 * Parameters for listing drafts
 */
export interface ListDraftsArgs extends BaseToolArguments {
  maxResults?: number;
  pageToken?: string;
}

/**
 * Parameters for sending drafts
 */
export interface SendDraftArgs extends BaseToolArguments {
  draftId: string;
}

// Calendar Types
/**
 * Parameters for listing calendar events
 * @property email - Calendar owner's email
 * @property query - Optional text search within events
 * @property maxResults - Maximum events to return
 * @property timeMin - Start of time range (ISO-8601)
 * @property timeMax - End of time range (ISO-8601)
 */
export interface CalendarEventParams extends BaseToolArguments {
  query?: string;
  maxResults?: number; // Default: 10
  timeMin?: string; // ISO-8601 format
  timeMax?: string; // ISO-8601 format
}

/**
 * Time specification for calendar events
 * @property dateTime - Event time in ISO-8601 format
 * @property timeZone - IANA timezone identifier
 */
export interface CalendarEventTime {
  dateTime: string; // e.g., "2024-02-18T15:30:00-06:00"
  timeZone?: string; // e.g., "America/Chicago"
}

/**
 * Calendar event attendee information
 * @property email - Attendee's email address
 */
export interface CalendarEventAttendee {
  email: string;
}

// Label Types
/**
 * Color settings for Gmail labels
 * @property textColor - Hex color code for label text
 * @property backgroundColor - Hex color code for label background
 */
export interface LabelColor {
  textColor: string; // e.g., "#000000"
  backgroundColor: string; // e.g., "#FFFFFF"
}

/**
 * Parameters for creating labels
 */
export interface CreateLabelArgs extends BaseToolArguments {
  name: string;
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
  color?: LabelColor;
}

/**
 * Parameters for updating labels
 */
export interface UpdateLabelArgs extends CreateLabelArgs {
  labelId: string;
}

/**
 * Parameters for deleting labels
 */
export interface DeleteLabelArgs extends BaseToolArguments {
  labelId: string;
}

/**
 * Parameters for modifying message labels
 */
export interface ModifyLabelsArgs extends BaseToolArguments {
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

// Label Filter Types
/**
 * Filter criteria for matching emails
 */
export interface LabelFilterCriteria {
  from?: string[];
  to?: string[];
  subject?: string;
  hasWords?: string[];
  doesNotHaveWords?: string[];
  hasAttachment?: boolean;
  size?: {
    operator: 'larger' | 'smaller';
    size: number;
  };
}

/**
 * Actions to take when filter matches
 */
export interface LabelFilterActions {
  addLabel: boolean;
  markImportant?: boolean;
  markRead?: boolean;
  archive?: boolean;
}

/**
 * Parameters for creating label filters
 */
export interface CreateLabelFilterArgs extends BaseToolArguments {
  labelId: string;
  criteria: LabelFilterCriteria;
  actions: LabelFilterActions;
}

/**
 * Parameters for getting label filters
 */
export interface GetLabelFiltersArgs extends BaseToolArguments {
  labelId?: string;  // Optional: get filters for specific label
}

/**
 * Parameters for updating label filters
 */
export interface UpdateLabelFilterArgs extends BaseToolArguments {
  filterId: string;
  criteria?: LabelFilterCriteria;
  actions?: LabelFilterActions;
}

/**
 * Parameters for deleting label filters
 */
export interface DeleteLabelFilterArgs extends BaseToolArguments {
  filterId: string;
}

// Re-export consolidated management types
export {
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams,
  ManageDraftParams,
  DraftAction
} from '../modules/gmail/types.js';
