import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { GmailError } from '../types.js';
import { AttachmentService } from '../../attachments/service.js';
import { DriveService } from '../../drive/service.js';
import { ATTACHMENT_FOLDERS } from '../../attachments/types.js';

export interface DraftData {
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

export class DraftService {
  private gmailClient?: ReturnType<typeof google.gmail>;
  private attachmentService: AttachmentService;

  constructor(
    private driveService: DriveService
  ) {
    this.attachmentService = new AttachmentService(driveService);
  }

  async initialize(): Promise<void> {
    // Initialization will be handled by Gmail service
  }

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

  async createDraft(email: string, data: DraftData) {
    try {
      const client = this.ensureClient();

      // Process attachments first
      const processedAttachments = [];
      if (data.attachments) {
        for (const attachment of data.attachments) {
          const result = await this.attachmentService.processAttachment(
            email,
            {
              type: attachment.driveFileId ? 'drive' : 'local',
              fileId: attachment.driveFileId,
              content: attachment.content,
              metadata: {
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size || 0
              }
            },
            ATTACHMENT_FOLDERS.OUTGOING
          );

          if (result.success && result.attachment) {
            processedAttachments.push(result.attachment);
          }
        }
      }

      // Construct email with attachments
      const boundary = `boundary_${Date.now()}`;
      const messageParts = [
        'MIME-Version: 1.0\n',
        `Content-Type: multipart/mixed; boundary="${boundary}"\n`,
        `To: ${data.to.join(', ')}\n`,
        data.cc?.length ? `Cc: ${data.cc.join(', ')}\n` : '',
        data.bcc?.length ? `Bcc: ${data.bcc.join(', ')}\n` : '',
        `Subject: ${data.subject}\n\n`,
        `--${boundary}\n`,
        'Content-Type: text/plain; charset="UTF-8"\n',
        'Content-Transfer-Encoding: 7bit\n\n',
        data.body,
        '\n'
      ];

      // Add attachments
      for (const attachment of processedAttachments) {
        const fileResult = await this.driveService.downloadFile(email, {
          fileId: attachment.id
        });
        if (fileResult.success) {
          const content = Buffer.from(fileResult.data);
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

      // Create draft
      const { data: draft } = await client.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: Buffer.from(fullMessage).toString('base64')
          }
        }
      });

      return {
        id: draft.id!,
        message: {
          id: draft.message?.id,
          threadId: draft.message?.threadId,
          labelIds: draft.message?.labelIds
        },
        attachments: processedAttachments
      };
    } catch (error) {
      throw new GmailError(
        'Failed to create draft',
        'CREATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async listDrafts(email: string) {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.drafts.list({
        userId: 'me'
      });

      return {
        drafts: data.drafts || [],
        nextPageToken: data.nextPageToken
      };
    } catch (error) {
      throw new GmailError(
        'Failed to list drafts',
        'LIST_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async getDraft(email: string, draftId: string) {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.drafts.get({
        userId: 'me',
        id: draftId,
        format: 'full'
      });

      return data;
    } catch (error) {
      throw new GmailError(
        'Failed to get draft',
        'GET_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async updateDraft(email: string, draftId: string, data: DraftData) {
    try {
      const client = this.ensureClient();

      // Process attachments first
      const processedAttachments = [];
      if (data.attachments) {
        for (const attachment of data.attachments) {
          const result = await this.attachmentService.processAttachment(
            email,
            {
              type: attachment.driveFileId ? 'drive' : 'local',
              fileId: attachment.driveFileId,
              content: attachment.content,
              metadata: {
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size || 0
              }
            },
            ATTACHMENT_FOLDERS.OUTGOING
          );

          if (result.success && result.attachment) {
            processedAttachments.push(result.attachment);
          }
        }
      }

      // Construct updated email
      const boundary = `boundary_${Date.now()}`;
      const messageParts = [
        'MIME-Version: 1.0\n',
        `Content-Type: multipart/mixed; boundary="${boundary}"\n`,
        `To: ${data.to.join(', ')}\n`,
        data.cc?.length ? `Cc: ${data.cc.join(', ')}\n` : '',
        data.bcc?.length ? `Bcc: ${data.bcc.join(', ')}\n` : '',
        `Subject: ${data.subject}\n\n`,
        `--${boundary}\n`,
        'Content-Type: text/plain; charset="UTF-8"\n',
        'Content-Transfer-Encoding: 7bit\n\n',
        data.body,
        '\n'
      ];

      // Add attachments
      for (const attachment of processedAttachments) {
        const fileResult = await this.driveService.downloadFile(email, {
          fileId: attachment.id
        });
        if (fileResult.success) {
          const content = Buffer.from(fileResult.data);
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

      // Update draft
      const { data: draft } = await client.users.drafts.update({
        userId: 'me',
        id: draftId,
        requestBody: {
          message: {
            raw: Buffer.from(fullMessage).toString('base64')
          }
        }
      });

      return {
        id: draft.id!,
        message: {
          id: draft.message?.id,
          threadId: draft.message?.threadId,
          labelIds: draft.message?.labelIds
        },
        attachments: processedAttachments
      };
    } catch (error) {
      throw new GmailError(
        'Failed to update draft',
        'UPDATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async deleteDraft(email: string, draftId: string) {
    try {
      const client = this.ensureClient();
      await client.users.drafts.delete({
        userId: 'me',
        id: draftId
      });

      return { success: true };
    } catch (error) {
      throw new GmailError(
        'Failed to delete draft',
        'DELETE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendDraft(email: string, draftId: string) {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.drafts.send({
        userId: 'me',
        requestBody: {
          id: draftId
        }
      });

      return {
        messageId: data.id!,
        threadId: data.threadId!,
        labelIds: data.labelIds
      };
    } catch (error) {
      throw new GmailError(
        'Failed to send draft',
        'SEND_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
}
