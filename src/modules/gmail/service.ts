import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAccountManager } from '../accounts/index.js';
import {
  GetEmailsParams,
  SendEmailParams,
  EmailResponse,
  SendEmailResponse,
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  GmailError,
  DEFAULT_GMAIL_SCOPES,
  GmailModuleConfig
} from './types.js';

export class GmailService {
  private oauth2Client!: OAuth2Client;
  private requiredScopes: string[];

  constructor(config?: GmailModuleConfig) {
    this.requiredScopes = config?.requiredScopes || DEFAULT_GMAIL_SCOPES;
  }

  async initialize(): Promise<void> {
    const accountManager = getAccountManager();
    this.oauth2Client = await accountManager.getAuthClient();
  }

  private async getGmailClient(email: string) {
    const accountManager = getAccountManager();
    
    // Get token for the email
    const tokenStatus = await accountManager.validateToken(email, this.requiredScopes);

    if (!tokenStatus.valid || !tokenStatus.token) {
      throw new GmailError(
        'Gmail authentication required',
        'AUTH_REQUIRED',
        'Please authenticate the account, which will grant all necessary permissions'
      );
    }

    // Set credentials on the OAuth client
    this.oauth2Client.setCredentials(tokenStatus.token);
    return google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  async getEmails({ email, query = '', maxResults = 10, labelIds = ['INBOX'] }: GetEmailsParams): Promise<EmailResponse[]> {
    try {
      const gmail = await this.getGmailClient(email);

      // List messages matching query
      const { data: messages } = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
        labelIds,
      });

      if (!messages.messages || messages.messages.length === 0) {
        return [];
      }

      // Get full message details for each email
      const emails = await Promise.all(
        messages.messages.map(async (message) => {
          const { data: email } = await gmail.users.messages.get({
            userId: 'me',
            id: message.id!,
            format: 'full',
          });

          const headers = email.payload?.headers || [];
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const from = headers.find(h => h.name === 'From')?.value || '';
          const to = headers.find(h => h.name === 'To')?.value || '';
          const date = headers.find(h => h.name === 'Date')?.value || '';

          // Get email body
          let body = '';
          if (email.payload?.body?.data) {
            body = Buffer.from(email.payload.body.data, 'base64').toString();
          } else if (email.payload?.parts) {
            const textPart = email.payload.parts.find(part => part.mimeType === 'text/plain');
            if (textPart?.body?.data) {
              body = Buffer.from(textPart.body.data, 'base64').toString();
            }
          }

          const response: EmailResponse = {
            id: email.id!,
            threadId: email.threadId!,
            labelIds: email.labelIds || undefined,
            snippet: email.snippet || undefined,
            subject,
            from,
            to,
            date,
            body,
          };

          return response;
        })
      );

      return emails;
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to get emails',
        'FETCH_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async sendEmail({ email, to, subject, body, cc = [], bcc = [] }: SendEmailParams): Promise<SendEmailResponse> {
    try {
      const gmail = await this.getGmailClient(email);

      // Construct email
      const message = [
        'Content-Type: text/plain; charset="UTF-8"\n',
        'MIME-Version: 1.0\n',
        'Content-Transfer-Encoding: 7bit\n',
        `To: ${to.join(', ')}\n`,
        cc.length > 0 ? `Cc: ${cc.join(', ')}\n` : '',
        bcc.length > 0 ? `Bcc: ${bcc.join(', ')}\n` : '',
        `Subject: ${subject}\n\n`,
        body,
      ].join('');

      // Encode the email in base64
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Send the email
      const { data } = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      return {
        messageId: data.id!,
        threadId: data.threadId!,
        labelIds: data.labelIds || undefined,
      };
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to send email',
        'SEND_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getWorkspaceGmailSettings({ email }: GetGmailSettingsParams): Promise<GetGmailSettingsResponse> {
    try {
      const gmail = await this.getGmailClient(email);

      // Get profile data
      const { data: profile } = await gmail.users.getProfile({
        userId: 'me'
      });

      // Get settings data
      const [
        { data: autoForwarding },
        { data: imap },
        { data: language },
        { data: pop },
        { data: vacation }
      ] = await Promise.all([
        gmail.users.settings.getAutoForwarding({ userId: 'me' }),
        gmail.users.settings.getImap({ userId: 'me' }),
        gmail.users.settings.getLanguage({ userId: 'me' }),
        gmail.users.settings.getPop({ userId: 'me' }),
        gmail.users.settings.getVacation({ userId: 'me' })
      ]);

      // Helper function to safely handle null/undefined values
      const nullSafeString = (value: string | null | undefined): string | undefined => 
        value === null ? undefined : value;

      const response: GetGmailSettingsResponse = {
        profile: {
          emailAddress: profile.emailAddress || '',
          messagesTotal: profile.messagesTotal || 0,
          threadsTotal: profile.threadsTotal || 0,
          historyId: profile.historyId || ''
        },
        settings: {
          autoForwarding: {
            enabled: Boolean(autoForwarding.enabled),
            emailAddress: nullSafeString(autoForwarding.emailAddress),
            disposition: nullSafeString(autoForwarding.disposition)
          },
          imap: {
            enabled: Boolean(imap.enabled),
            autoExpunge: imap.autoExpunge === null ? undefined : imap.autoExpunge,
            expungeBehavior: nullSafeString(imap.expungeBehavior),
            maxFolderSize: imap.maxFolderSize === null ? undefined : imap.maxFolderSize
          },
          language: {
            displayLanguage: language.displayLanguage || 'en'
          },
          pop: {
            enabled: Boolean(pop.accessWindow !== null), // POP is enabled if accessWindow is set
            accessWindow: nullSafeString(pop.accessWindow),
            disposition: nullSafeString(pop.disposition)
          },
          vacationResponder: {
            enabled: Boolean(vacation.enableAutoReply),
            startTime: nullSafeString(vacation.startTime),
            endTime: nullSafeString(vacation.endTime),
            message: nullSafeString(vacation.responseBodyHtml) || nullSafeString(vacation.responseBodyPlainText),
            responseSubject: nullSafeString(vacation.responseSubject)
          }
        }
      };

      return response;
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to get Gmail settings',
        'SETTINGS_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
