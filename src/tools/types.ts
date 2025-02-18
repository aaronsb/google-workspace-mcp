export interface McpToolResponse {
  content: {
    type: 'text';
    text: string;
  }[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface ToolArguments {
  [key: string]: unknown;
}

export interface BaseToolArguments extends Record<string, unknown> {
  email: string;
}

// Gmail Types
export interface GmailSearchParams {
  email: string;
  search?: {
    from?: string | string[];
    to?: string | string[];
    subject?: string;
    content?: string;
    after?: string;
    before?: string;
    hasAttachment?: boolean;
    labels?: string[];
    excludeLabels?: string[];
    includeSpam?: boolean;
    isUnread?: boolean;
  };
  options?: {
    maxResults?: number;
  };
}

export interface EmailContent {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

// Calendar Types
export interface CalendarEventParams extends Record<string, unknown> {
  email: string;
  query?: string;
  maxResults?: number;
  timeMin?: string;
  timeMax?: string;
}

export interface CalendarEventTime {
  dateTime: string;
  timeZone?: string;
}

export interface CalendarEventAttendee {
  email: string;
}

// Label Types
export interface LabelColor {
  textColor?: string;
  backgroundColor?: string;
}

export interface LabelVisibility {
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
}

export interface LabelModification extends Record<string, unknown> {
  email: string;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}
