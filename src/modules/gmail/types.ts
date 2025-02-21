export interface BaseGmailAttachment {
  id: string;          // Gmail attachment ID
  name: string;        // Filename
  mimeType: string;    // MIME type
  size: number;        // Size in bytes
}

export interface IncomingGmailAttachment extends BaseGmailAttachment {
  content?: string;    // Base64 content when retrieved
  path?: string;       // Local filesystem path when downloaded
}

export interface OutgoingGmailAttachment extends BaseGmailAttachment {
  content: string;     // Base64 content required when sending
}

export type GmailAttachment = IncomingGmailAttachment | OutgoingGmailAttachment;

export interface Label {
  id: string;
  name: string;
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
  type?: 'system' | 'user';
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface DraftResponse {
  id: string;
  message: {
    id: string;
    threadId: string;
    labelIds: string[];
  };
  updated: string;
}

export interface GetDraftsResponse {
  drafts: DraftResponse[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface DraftEmailParams {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  attachments?: {
    driveFileId?: string;
    content?: string;
    name: string;
    mimeType: string;
    size?: number;
  }[];
}

export interface GetDraftsParams {
  email: string;
  maxResults?: number;
  pageToken?: string;
}

export interface SendDraftParams {
  email: string;
  draftId: string;
}

export interface GetLabelsResponse {
  labels: Label[];
  nextPageToken?: string;
}

export interface LabelFilter {
  id: string;
  labelId: string;
  criteria: LabelFilterCriteria;
  actions: LabelFilterActions;
}

export interface GetLabelFiltersResponse {
  filters: LabelFilter[];
}

export interface CreateLabelParams {
  email: string;
  name: string;
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
  color?: {
    textColor: string;
    backgroundColor: string;
  };
}

export interface UpdateLabelParams {
  email: string;
  labelId: string;
  name?: string;
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
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

export interface ModifyMessageLabelsParams {
  email: string;
  messageId: string;
  addLabelIds: string[];
  removeLabelIds: string[];
}

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

export interface LabelFilterActions {
  addLabel?: boolean;
  markImportant?: boolean;
  markRead?: boolean;
  archive?: boolean;
}

export interface CreateLabelFilterParams {
  email: string;
  labelId: string;
  criteria: LabelFilterCriteria;
  actions: LabelFilterActions;
}

export interface GetLabelFiltersParams {
  email: string;
  labelId?: string;
}

export interface UpdateLabelFilterParams {
  email: string;
  filterId: string;
  labelId: string;
  criteria: LabelFilterCriteria;
  actions: LabelFilterActions;
}

export interface DeleteLabelFilterParams {
  email: string;
  filterId: string;
}

export interface GetGmailSettingsParams {
  email: string;
}

export interface GetGmailSettingsResponse {
  profile: {
    emailAddress: string;
    messagesTotal: number;
    threadsTotal: number;
    historyId: string;
  };
  settings: {
    language?: {
      displayLanguage: string;
    };
    autoForwarding?: {
      enabled: boolean;
      emailAddress?: string;
    };
    imap?: {
      enabled: boolean;
      autoExpunge?: boolean;
      expungeBehavior?: string;
    };
    pop?: {
      enabled: boolean;
      accessWindow?: string;
    };
    vacationResponder?: {
      enabled: boolean;
      startTime?: string;
      endTime?: string;
      responseSubject?: string;
      message?: string;
    };
  };
}

export interface GmailModuleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface SearchCriteria {
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
  attachments?: IncomingGmailAttachment[];
}

export interface ThreadInfo {
  messages: string[];
  participants: string[];
  subject: string;
  lastUpdated: string;
}

export interface GetEmailsParams {
  email: string;
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
  email: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  attachments?: OutgoingGmailAttachment[];
}

export interface SendEmailResponse {
  messageId: string;
  threadId: string;
  labelIds?: string[];
  attachments?: GmailAttachment[];
}

export class GmailError extends Error implements GmailError {
  code: string;
  details?: string;

  constructor(message: string, code: string, details?: string) {
    super(message);
    this.name = 'GmailError';
    this.code = code;
    this.details = details;
  }
}
