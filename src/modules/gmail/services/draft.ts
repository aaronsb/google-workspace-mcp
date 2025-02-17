import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {
  DraftEmailParams,
  DraftResponse,
  GetDraftsParams,
  GetDraftsResponse,
  SendDraftParams,
  SendEmailResponse,
  GmailError
} from '../types.js';
import { EmailService } from './email.js';

export class DraftService {
  constructor(
    private emailService: EmailService,
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
   * Creates a new email draft, with support for both new emails and replies
   */
  async createDraft({ 
    email,
    to, 
    subject, 
    body, 
    cc = [], 
    bcc = [], 
    replyToMessageId,
    threadId,
    references = [],
    inReplyTo
  }: DraftEmailParams): Promise<DraftResponse> {
    try {
      // If this is a reply, get the original message to properly set up headers
      let originalMessage;
      if (replyToMessageId) {
        const response = await this.emailService.getEmails({
          email,
          messageIds: [replyToMessageId],
          options: { includeHeaders: true }
        });
        originalMessage = response.emails[0];
        
        // If not explicitly provided, use headers from original message
        if (!threadId) threadId = originalMessage.threadId;
        if (!inReplyTo) inReplyTo = replyToMessageId;
        if (references.length === 0 && originalMessage.headers) {
          const existingRefs = originalMessage.headers['References'];
          if (existingRefs) {
            references = existingRefs.split(/\s+/);
          }
          references.push(replyToMessageId);
        }
      }

      // Construct email headers
      const headers = [
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        'Content-Transfer-Encoding: 7bit',
        `To: ${to.join(', ')}`,
        cc.length > 0 ? `Cc: ${cc.join(', ')}` : '',
        bcc.length > 0 ? `Bcc: ${bcc.join(', ')}` : '',
        `Subject: ${subject}`,
        threadId ? `Thread-ID: ${threadId}` : '',
        inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
        references.length > 0 ? `References: ${references.join(' ')}` : '',
      ].filter(Boolean); // Remove empty strings

      // Construct full message
      const message = [
        ...headers,
        '',  // Empty line between headers and body
        body
      ].join('\n');

      // Encode the email in base64
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Create the draft
      const client = this.ensureClient();
      const { data } = await client.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: encodedMessage,
            threadId  // Include threadId for replies
          },
        },
      });

      if (!data.id || !data.message) {
        throw new GmailError(
          'Invalid draft response',
          'DRAFT_ERROR',
          'Draft creation failed due to invalid response'
        );
      }

      // Get full message details
      const messageResponse = await this.emailService.getEmails({
        email,
        messageIds: [data.message.id!],
      });

      return {
        id: data.id,
        message: messageResponse.emails[0],
        updated: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to create draft',
        'DRAFT_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Gets a list of email drafts
   */
  async getDrafts({ email, maxResults = 10, pageToken }: GetDraftsParams): Promise<GetDraftsResponse> {
    try {
      // List drafts
      const client = this.ensureClient();
      const { data } = await client.users.drafts.list({
        userId: 'me',
        maxResults,
        pageToken,
      });

      if (!data.drafts) {
        return {
          drafts: [],
          resultSizeEstimate: 0,
        };
      }

      // Get full draft details including messages
      const drafts = await Promise.all(
        data.drafts.map(async (draft) => {
          const client = this.ensureClient();
          const { data: draftData } = await client.users.drafts.get({
            userId: 'me',
            id: draft.id!,
            format: 'full',
          });

          if (!draftData.message?.id) {
            throw new GmailError(
              'Invalid draft data',
              'DRAFT_ERROR',
              'Draft retrieval failed due to missing message'
            );
          }

          // Get full message details
          const messageResponse = await this.emailService.getEmails({
            email,
            messageIds: [draftData.message.id],
          });

          return {
            id: draftData.id!,
            message: messageResponse.emails[0],
            updated: draftData.message.internalDate
              ? new Date(parseInt(draftData.message.internalDate)).toISOString()
              : new Date().toISOString(),
          };
        })
      );

      return {
        drafts,
        nextPageToken: data.nextPageToken || undefined,
        resultSizeEstimate: data.resultSizeEstimate || 0,
      };
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to get drafts',
        'DRAFT_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Sends an existing draft
   */
  async sendDraft({ email, draftId }: SendDraftParams): Promise<SendEmailResponse> {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.drafts.send({
        userId: 'me',
        requestBody: {
          id: draftId,
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
        'Failed to send draft',
        'DRAFT_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
