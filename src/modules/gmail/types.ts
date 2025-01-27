export interface GetEmailsParams {
  email: string;
  query?: string;
  maxResults?: number;
  labelIds?: string[];
  messageIds?: string[]; // For directly fetching specific emails
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
}

export interface SendEmailResponse {
  messageId: string;
  threadId: string;
  labelIds?: string[];
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
