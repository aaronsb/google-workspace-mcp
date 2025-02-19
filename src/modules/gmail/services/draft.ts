import { gmail_v1 } from 'googleapis';
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

export type DraftAction = 'create' | 'read' | 'update' | 'delete' | 'send';

export interface ManageDraftParams {
  action: DraftAction;
  email: string;
  draftId?: string;
  data?: {
    to: string[];
    subject: string;
    body: string;
    cc?: string[];
    bcc?: string[];
    replyToMessageId?: string;
    threadId?: string;
    references?: string[];
    inReplyTo?: string;
  };
}

export class DraftService {
  private client: gmail_v1.Gmail | null = null;

  constructor(private emailService: EmailService) {}

  updateClient(client: gmail_v1.Gmail) {
    this.client = client;
  }

  private ensureClient(): gmail_v1.Gmail {
    if (!this.client) {
      throw new GmailError(
        'Gmail client not initialized',
        'CLIENT_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.client;
  }

  async manageDraft(params: ManageDraftParams): Promise<DraftResponse | GetDraftsResponse | SendEmailResponse | void> {
    this.ensureClient();

    switch (params.action) {
      case 'create':
        if (!params.data?.to || !params.data.subject || !params.data.body) {
          throw new GmailError(
            'Missing required draft data',
            'VALIDATION_ERROR',
            'Please provide to, subject, and body for draft creation'
          );
        }
        return this.createDraft({
          email: params.email,
          to: params.data.to,
          subject: params.data.subject,
          body: params.data.body,
          cc: params.data.cc,
          bcc: params.data.bcc,
          replyToMessageId: params.data.replyToMessageId,
          threadId: params.data.threadId,
          references: params.data.references,
          inReplyTo: params.data.inReplyTo
        });

      case 'read':
        if (params.draftId) {
          return this.getDraft(params.email, params.draftId);
        }
        return this.getDrafts({ email: params.email });

      case 'update':
        if (!params.draftId) {
          throw new GmailError(
            'Draft ID is required for update',
            'VALIDATION_ERROR',
            'Please provide a draft ID'
          );
        }
        if (!params.data) {
          throw new GmailError(
            'No update data provided',
            'VALIDATION_ERROR',
            'Please provide data to update'
          );
        }
        if (!params.data.to || !params.data.subject || !params.data.body) {
          throw new GmailError(
            'Missing required draft data',
            'VALIDATION_ERROR',
            'Please provide to, subject, and body for draft update'
          );
        }
        return this.updateDraft({
          email: params.email,
          draftId: params.draftId,
          to: params.data.to,
          subject: params.data.subject,
          body: params.data.body,
          cc: params.data.cc,
          bcc: params.data.bcc,
          replyToMessageId: params.data.replyToMessageId,
          threadId: params.data.threadId,
          references: params.data.references,
          inReplyTo: params.data.inReplyTo
        });

      case 'delete':
        if (!params.draftId) {
          throw new GmailError(
            'Draft ID is required for deletion',
            'VALIDATION_ERROR',
            'Please provide a draft ID'
          );
        }
        return this.deleteDraft(params.email, params.draftId);

      case 'send':
        if (!params.draftId) {
          throw new GmailError(
            'Draft ID is required for sending',
            'VALIDATION_ERROR',
            'Please provide a draft ID'
          );
        }
        return this.sendDraft({
          email: params.email,
          draftId: params.draftId
        });

      default:
        throw new GmailError(
          'Invalid draft action',
          'VALIDATION_ERROR',
          `Action ${params.action} is not supported`
        );
    }
  }

  private async createDraft(params: DraftEmailParams): Promise<DraftResponse> {
    try {
      // If this is a reply, get the original message to properly set up headers
      let originalMessage;
      if (params.replyToMessageId) {
        const response = await this.emailService.getEmails({
          email: params.email,
          messageIds: [params.replyToMessageId],
          options: { includeHeaders: true }
        });
        originalMessage = response.emails[0];
        
        // If not explicitly provided, use headers from original message
        if (!params.threadId) params.threadId = originalMessage.threadId;
        if (!params.inReplyTo) params.inReplyTo = params.replyToMessageId;
        if (!params.references || params.references.length === 0) {
          const existingRefs = originalMessage.headers?.['References'];
          if (existingRefs) {
            params.references = existingRefs.split(/\s+/);
          }
          params.references = [...(params.references || []), params.replyToMessageId];
        }
      }

      const message = this.constructEmailMessage(params);
      const encodedMessage = this.encodeMessage(message);

      const client = this.ensureClient();
      const { data } = await client.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: encodedMessage,
            threadId: params.threadId
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

      const messageResponse = await this.emailService.getEmails({
        email: params.email,
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

  private async getDraft(email: string, draftId: string): Promise<DraftResponse> {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.drafts.get({
        userId: 'me',
        id: draftId,
        format: 'full',
      });

      if (!data.message?.id) {
        throw new GmailError(
          'Invalid draft data',
          'DRAFT_ERROR',
          'Draft retrieval failed due to missing message'
        );
      }

      const messageResponse = await this.emailService.getEmails({
        email,
        messageIds: [data.message.id],
      });

      return {
        id: data.id!,
        message: messageResponse.emails[0],
        updated: data.message.internalDate
          ? new Date(parseInt(data.message.internalDate)).toISOString()
          : new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to get draft',
        'DRAFT_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async getDrafts(params: GetDraftsParams): Promise<GetDraftsResponse> {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.drafts.list({
        userId: 'me',
        maxResults: params.maxResults,
        pageToken: params.pageToken,
      });

      if (!data.drafts) {
        return {
          drafts: [],
          resultSizeEstimate: 0,
        };
      }

      const drafts = await Promise.all(
        data.drafts.map(draft => this.getDraft(params.email, draft.id!))
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

  private async updateDraft(params: DraftEmailParams & { draftId: string }): Promise<DraftResponse> {
    try {
      const message = this.constructEmailMessage(params);
      const encodedMessage = this.encodeMessage(message);

      const client = this.ensureClient();
      const { data } = await client.users.drafts.update({
        userId: 'me',
        id: params.draftId,
        requestBody: {
          message: {
            raw: encodedMessage,
            threadId: params.threadId
          },
        },
      });

      if (!data.id || !data.message) {
        throw new GmailError(
          'Invalid draft response',
          'DRAFT_ERROR',
          'Draft update failed due to invalid response'
        );
      }

      const messageResponse = await this.emailService.getEmails({
        email: params.email,
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
        'Failed to update draft',
        'DRAFT_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async deleteDraft(email: string, draftId: string): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.users.drafts.delete({
        userId: 'me',
        id: draftId,
      });
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to delete draft',
        'DRAFT_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async sendDraft(params: SendDraftParams): Promise<SendEmailResponse> {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.drafts.send({
        userId: 'me',
        requestBody: {
          id: params.draftId,
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

  private constructEmailMessage(params: DraftEmailParams): string {
    const headers = [
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      'Content-Transfer-Encoding: 7bit',
      `To: ${params.to.join(', ')}`,
      params.cc?.length ? `Cc: ${params.cc.join(', ')}` : '',
      params.bcc?.length ? `Bcc: ${params.bcc.join(', ')}` : '',
      `Subject: ${params.subject}`,
      params.threadId ? `Thread-ID: ${params.threadId}` : '',
      params.inReplyTo ? `In-Reply-To: ${params.inReplyTo}` : '',
      params.references?.length ? `References: ${params.references.join(' ')}` : '',
    ].filter(Boolean);

    return [
      ...headers,
      '',  // Empty line between headers and body
      params.body
    ].join('\n');
  }

  private encodeMessage(message: string): string {
    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
