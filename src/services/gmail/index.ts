import { google } from 'googleapis';
import { BaseGoogleService, GoogleServiceError } from '../base/BaseGoogleService.js';
import {
  GetEmailsParams,
  SendEmailParams,
  EmailResponse,
  SendEmailResponse,
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  SearchCriteria,
  GetEmailsResponse,
  ThreadInfo
} from '../../modules/gmail/types.js';

/**
 * Gmail service implementation extending BaseGoogleService.
 * Handles Gmail-specific operations while leveraging common Google API functionality.
 */
export class GmailService extends BaseGoogleService<ReturnType<typeof google.gmail>> {
  constructor() {
    super({
      serviceName: 'gmail',
      version: 'v1'
    });
  }

  /**
   * Gets an authenticated Gmail client
   */
  private async getGmailClient(email: string) {
    return this.getAuthenticatedClient(
      email,
      (auth) => google.gmail({ version: 'v1', auth })
    );
  }

  /**
   * Extracts all headers into a key-value map
   */
  private extractHeaders(headers: { name: string; value: string }[]): { [key: string]: string } {
    return headers.reduce((acc, header) => {
      acc[header.name] = header.value;
      return acc;
    }, {} as { [key: string]: string });
  }

  /**
   * Groups emails by thread ID and extracts thread information
   */
  private groupEmailsByThread(emails: EmailResponse[]): { [threadId: string]: ThreadInfo } {
    return emails.reduce((threads, email) => {
      if (!threads[email.threadId]) {
        threads[email.threadId] = {
          messages: [],
          participants: [],
          subject: email.subject,
          lastUpdated: email.date
        };
      }

      const thread = threads[email.threadId];
      thread.messages.push(email.id);
      
      if (!thread.participants.includes(email.from)) {
        thread.participants.push(email.from);
      }
      if (email.to && !thread.participants.includes(email.to)) {
        thread.participants.push(email.to);
      }
      
      const emailDate = new Date(email.date);
      const threadDate = new Date(thread.lastUpdated);
      if (emailDate > threadDate) {
        thread.lastUpdated = email.date;
      }

      return threads;
    }, {} as { [threadId: string]: ThreadInfo });
  }

  /**
   * Builds a Gmail search query string from SearchCriteria
   */
  private buildSearchQuery(criteria: SearchCriteria = {}): string {
    const queryParts: string[] = [];

    if (criteria.from) {
      const fromAddresses = Array.isArray(criteria.from) ? criteria.from : [criteria.from];
      if (fromAddresses.length === 1) {
        queryParts.push(`from:${fromAddresses[0]}`);
      } else {
        queryParts.push(`{${fromAddresses.map(f => `from:${f}`).join(' OR ')}}`);
      }
    }

    if (criteria.to) {
      const toAddresses = Array.isArray(criteria.to) ? criteria.to : [criteria.to];
      if (toAddresses.length === 1) {
        queryParts.push(`to:${toAddresses[0]}`);
      } else {
        queryParts.push(`{${toAddresses.map(t => `to:${t}`).join(' OR ')}}`);
      }
    }

    if (criteria.subject) {
      const escapedSubject = criteria.subject.replace(/["\\]/g, '\\$&');
      queryParts.push(`subject:"${escapedSubject}"`);
    }

    if (criteria.content) {
      const escapedContent = criteria.content.replace(/["\\]/g, '\\$&');
      queryParts.push(`"${escapedContent}"`);
    }

    if (criteria.after) {
      const afterDate = new Date(criteria.after);
      const afterStr = `${afterDate.getFullYear()}/${(afterDate.getMonth() + 1).toString().padStart(2, '0')}/${afterDate.getDate().toString().padStart(2, '0')}`;
      queryParts.push(`after:${afterStr}`);
    }
    if (criteria.before) {
      const beforeDate = new Date(criteria.before);
      const beforeStr = `${beforeDate.getFullYear()}/${(beforeDate.getMonth() + 1).toString().padStart(2, '0')}/${beforeDate.getDate().toString().padStart(2, '0')}`;
      queryParts.push(`before:${beforeStr}`);
    }

    if (criteria.hasAttachment) {
      queryParts.push('has:attachment');
    }

    if (criteria.labels && criteria.labels.length > 0) {
      criteria.labels.forEach(label => {
        queryParts.push(`label:${label}`);
      });
    }

    if (criteria.excludeLabels && criteria.excludeLabels.length > 0) {
      criteria.excludeLabels.forEach(label => {
        queryParts.push(`-label:${label}`);
      });
    }

    if (criteria.includeSpam) {
      queryParts.push('in:anywhere');
    }

    if (criteria.isUnread !== undefined) {
      queryParts.push(criteria.isUnread ? 'is:unread' : 'is:read');
    }

    return queryParts.join(' ');
  }

  /**
   * Gets emails with proper scope handling for search and content access.
   */
  async getEmails({ email, search = {}, options = {}, messageIds }: GetEmailsParams): Promise<GetEmailsResponse> {
    try {
      const gmail = await this.getGmailClient(email);
      const maxResults = options.maxResults || 10;
      
      let messages;
      let nextPageToken: string | undefined;
      
      if (messageIds && messageIds.length > 0) {
        messages = { messages: messageIds.map(id => ({ id })) };
      } else {
        const query = this.buildSearchQuery(search);
        
        const { data } = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults,
          pageToken: options.pageToken,
        });
        
        messages = data;
        nextPageToken = data.nextPageToken || undefined;
      }

      if (!messages.messages || messages.messages.length === 0) {
        return {
          emails: [],
          resultSummary: {
            total: 0,
            returned: 0,
            hasMore: false,
            searchCriteria: search
          }
        };
      }

      const emails = await Promise.all(
        messages.messages.map(async (message) => {
          const { data: email } = await gmail.users.messages.get({
            userId: 'me',
            id: message.id!,
            format: options.format || 'full',
          });

          const headers = (email.payload?.headers || []).map(h => ({
            name: h.name || '',
            value: h.value || ''
          }));
          const subject = headers.find(h => h.name === 'Subject')?.value || '';
          const from = headers.find(h => h.name === 'From')?.value || '';
          const to = headers.find(h => h.name === 'To')?.value || '';
          const date = headers.find(h => h.name === 'Date')?.value || '';

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
            headers: options.includeHeaders ? this.extractHeaders(headers) : undefined,
            isUnread: email.labelIds?.includes('UNREAD') || false,
            hasAttachment: email.payload?.parts?.some(part => part.filename && part.filename.length > 0) || false
          };

          return response;
        })
      );

      const threads = options.threadedView ? this.groupEmailsByThread(emails) : undefined;

      if (options.sortOrder) {
        emails.sort((a, b) => {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          return options.sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
        });
      }

      return {
        emails,
        nextPageToken,
        resultSummary: {
          total: messages.resultSizeEstimate || emails.length,
          returned: emails.length,
          hasMore: Boolean(nextPageToken),
          searchCriteria: search
        },
        threads
      };
    } catch (error) {
      throw this.handleError(error, 'Failed to get emails');
    }
  }

  /**
   * Sends an email from the specified account
   */
  async sendEmail({ email, to, subject, body, cc = [], bcc = [] }: SendEmailParams): Promise<SendEmailResponse> {
    try {
      const gmail = await this.getGmailClient(email);

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

      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

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
      throw this.handleError(error, 'Failed to send email');
    }
  }

  /**
   * Gets Gmail settings and profile information
   */
  async getWorkspaceGmailSettings({ email }: GetGmailSettingsParams): Promise<GetGmailSettingsResponse> {
    try {
      const gmail = await this.getGmailClient(email);

      const { data: profile } = await gmail.users.getProfile({
        userId: 'me'
      });

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

      const nullSafeString = (value: string | null | undefined): string | undefined => 
        value === null ? undefined : value;

      return {
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
            enabled: Boolean(pop.accessWindow !== null),
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
    } catch (error) {
      throw this.handleError(error, 'Failed to get Gmail settings');
    }
  }
}
