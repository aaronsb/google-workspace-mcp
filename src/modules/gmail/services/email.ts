import { google, gmail_v1 } from 'googleapis';
import {
  EmailResponse,
  GetEmailsParams,
  GetEmailsResponse,
  SendEmailParams,
  SendEmailResponse,
  ThreadInfo,
  GmailError
} from '../types.js';
import { SearchService } from './search.js';
import { AttachmentService } from '../../attachments/service.js';
import { ATTACHMENT_FOLDERS, AttachmentSource, AttachmentMetadata } from '../../attachments/types.js';
import { DriveService } from '../../drive/service.js';

type GmailMessage = gmail_v1.Schema$Message;

export class EmailService {
  constructor(
    private searchService: SearchService,
    private attachmentService: AttachmentService,
    private driveService: DriveService,
    private gmailClient?: ReturnType<typeof google.gmail>
  ) {}

  /**
   * Updates the Gmail client instance
   * @param client - New Gmail client instance
   */
  updateClient(client: ReturnType<typeof google.gmail>) {
    this.gmailClient = client;
  }

  private ensureClient(): ReturnType<typeof google.gmail> {
    if (!this.gmailClient) {
      throw new GmailError(
        'Gmail client not initialized',
        'CLIENT_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.gmailClient;
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
   * Process email attachments and store in Drive
   */
  private async processEmailAttachments(
    email: string,
    message: GmailMessage,
    isIncoming: boolean
  ): Promise<AttachmentMetadata[]> {
    const attachments: AttachmentMetadata[] = [];
    
    if (!message.payload?.parts) {
      return attachments;
    }

    for (const part of message.payload.parts) {
      if (part.filename && part.body?.attachmentId) {
        // Get attachment content
        const client = this.ensureClient();
        const attachment = await client.users.messages.attachments.get({
          userId: 'me',
          messageId: message.id!,
          id: part.body.attachmentId
        });

        if (attachment.data.data) {
          // Process attachment and store in Drive
          const result = await this.attachmentService.processAttachment(
            email,
            {
              type: 'local',
              content: attachment.data.data,
              metadata: {
                name: part.filename,
                mimeType: part.mimeType || 'application/octet-stream',
                size: parseInt(String(part.body.size || '0'))
              }
            },
            isIncoming ? ATTACHMENT_FOLDERS.INCOMING : ATTACHMENT_FOLDERS.OUTGOING
          );

          if (result.success && result.attachment) {
            attachments.push(result.attachment);
          }
        }
      }
    }

    return attachments;
  }

  /**
   * Enhanced getEmails method with support for advanced search criteria and options
   */
  async getEmails({ email, search = {}, options = {}, messageIds }: GetEmailsParams): Promise<GetEmailsResponse> {
    try {
      const maxResults = options.maxResults || 10;
      
      let messages;
      let nextPageToken: string | undefined;
      
      if (messageIds && messageIds.length > 0) {
        messages = { messages: messageIds.map(id => ({ id })) };
      } else {
        // Build search query from criteria
        const query = this.searchService.buildSearchQuery(search);
        
        // List messages matching query
        const client = this.ensureClient();
        const { data } = await client.users.messages.list({
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

      // Get full message details
      const emails = await Promise.all(
        messages.messages.map(async (message) => {
          const client = this.ensureClient();
          const { data: email } = await client.users.messages.get({
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

          // Process attachments if present
          const hasAttachments = email.payload?.parts?.some(part => part.filename && part.filename.length > 0) || false;
          const attachments = hasAttachments ? 
            await this.processEmailAttachments(String(email.id), email, true) : 
            undefined;

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
            hasAttachment: hasAttachments,
            attachments
          };

          return response;
        })
      );

      // Handle threaded view if requested
      const threads = options.threadedView ? this.groupEmailsByThread(emails) : undefined;

      // Sort emails if requested
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

  async sendEmail({ email, to, subject, body, cc = [], bcc = [], attachments = [] }: SendEmailParams): Promise<SendEmailResponse> {
    try {
      // Process attachments first
      const processedAttachments = [];
      for (const attachment of attachments) {
        const source: AttachmentSource = attachment.driveFileId ? 
          {
            type: 'drive',
            fileId: attachment.driveFileId,
            metadata: {
              name: attachment.name,
              mimeType: attachment.mimeType,
              size: attachment.size
            }
          } : 
          {
            type: 'local',
            content: attachment.content!,
            metadata: {
              name: attachment.name,
              mimeType: attachment.mimeType,
              size: attachment.size
            }
          };

        const result = await this.attachmentService.processAttachment(
          email,
          source,
          ATTACHMENT_FOLDERS.OUTGOING
        );

        if (result.success && result.attachment) {
          processedAttachments.push(result.attachment);
        }
      }

      // Construct email with attachments
      const boundary = `boundary_${Date.now()}`;
      const messageParts = [
        'MIME-Version: 1.0\n',
        `Content-Type: multipart/mixed; boundary="${boundary}"\n`,
        `To: ${to.join(', ')}\n`,
        cc.length > 0 ? `Cc: ${cc.join(', ')}\n` : '',
        bcc.length > 0 ? `Bcc: ${bcc.join(', ')}\n` : '',
        `Subject: ${subject}\n\n`,
        `--${boundary}\n`,
        'Content-Type: text/plain; charset="UTF-8"\n',
        'Content-Transfer-Encoding: 7bit\n\n',
        body,
        '\n'
      ];

      // Add attachments
      for (const attachment of processedAttachments) {
        const fileResult = await this.attachmentService.downloadAttachment(email, attachment.id);
        if (fileResult.success && fileResult.attachment) {
          // Get attachment content from Drive
          const attachmentContent = await this.driveService.downloadFile(email, {
            fileId: attachment.id
          });
          if (!attachmentContent.success) {
            continue;
          }
          const content = Buffer.from(attachmentContent.data);
          messageParts.push(
            `--${boundary}\n`,
            `Content-Type: ${attachment.mimeType}\n`,
            'Content-Transfer-Encoding: base64\n',
            `Content-Disposition: attachment; filename="${attachment.name}"\n\n`,
            content.toString('base64'),
            '\n'
          );
        }
      }

      messageParts.push(`--${boundary}--`);
      const fullMessage = messageParts.join('');

      // Encode the email in base64
      const encodedMessage = Buffer.from(fullMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Send the email
      const client = this.ensureClient();
      const { data } = await client.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      const response: SendEmailResponse = {
        messageId: data.id!,
        threadId: data.threadId!,
        labelIds: data.labelIds || undefined
      };

      if (processedAttachments.length > 0) {
        response.attachments = processedAttachments;
      }

      return response;
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
}
