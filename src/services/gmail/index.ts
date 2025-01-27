import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TokenManager } from '../../modules/accounts/token.js';

interface GetEmailsParams {
  email: string;
  query?: string;
  maxResults?: number;
  labelIds?: string[];
}

interface SendEmailParams {
  email: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

export class GmailService {
  private tokenManager: TokenManager;
  private oauth2Client: OAuth2Client;

  constructor(oauth2Client: OAuth2Client) {
    this.oauth2Client = oauth2Client;
    this.tokenManager = new TokenManager();
  }

  private async getGmailClient(email: string) {
    try {
      // Load token without validation
      const token = await this.tokenManager.loadToken(email);
      if (!token) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Gmail authentication required'
        );
      }

      // Set credentials and create client
      this.oauth2Client.setCredentials(token);
      return google.gmail({ version: 'v1', auth: this.oauth2Client });
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        'Failed to initialize Gmail client'
      );
    }
  }

  private async handleGmailOperation<T>(email: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      // Handle 401/403 errors by attempting token refresh
      if (error.code === 401 || error.code === 403) {
        const token = await this.tokenManager.validateToken(email);
        if (token.valid && token.token) {
          this.oauth2Client.setCredentials(token.token);
          return await operation();
        }
      }
      throw error;
    }
  }

  async getEmails({ email, query = '', maxResults = 10, labelIds = ['INBOX'] }: GetEmailsParams) {
    const gmail = await this.getGmailClient(email);

    return this.handleGmailOperation(email, async () => {
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
            format: 'full'
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

          return {
            id: email.id,
            threadId: email.threadId,
            labelIds: email.labelIds,
            snippet: email.snippet,
            subject,
            from,
            to,
            date,
            body,
          };
        })
      );

      return emails;
    });
  }

  async sendEmail({ email, to, subject, body, cc = [], bcc = [] }: SendEmailParams) {
    const gmail = await this.getGmailClient(email);

    return this.handleGmailOperation(email, async () => {
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
        messageId: data.id,
        threadId: data.threadId,
        labelIds: data.labelIds,
      };
    });
  }
}
