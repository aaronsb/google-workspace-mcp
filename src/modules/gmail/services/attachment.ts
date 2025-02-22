import { google } from 'googleapis';
import { 
  GmailAttachment,
  IncomingGmailAttachment,
  OutgoingGmailAttachment,
  GmailError 
} from '../types.js';
import { AttachmentIndexService } from '../../attachments/index-service.js';

export class GmailAttachmentService {
  private static instance: GmailAttachmentService;
  private indexService: AttachmentIndexService;
  private gmailClient?: ReturnType<typeof google.gmail>;

  private constructor() {
    this.indexService = AttachmentIndexService.getInstance();
  }

  /**
   * Add attachment metadata to the index
   */
  addAttachment(messageId: string, attachment: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
  }): void {
    this.indexService.addAttachment(messageId, attachment);
  }

  public static getInstance(): GmailAttachmentService {
    if (!GmailAttachmentService.instance) {
      GmailAttachmentService.instance = new GmailAttachmentService();
    }
    return GmailAttachmentService.instance;
  }

  /**
   * Updates the Gmail client instance
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
   * Get attachment content from Gmail
   */
  async getAttachment(
    email: string,
    messageId: string,
    filename: string
  ): Promise<IncomingGmailAttachment> {
    try {
      // Get original metadata from index
      const metadata = this.indexService.getMetadata(messageId, filename);
      if (!metadata) {
        throw new GmailError(
          'Attachment not found',
          'ATTACHMENT_ERROR',
          'Attachment metadata not found - message may need to be refreshed'
        );
      }

      const client = this.ensureClient();
      const { data } = await client.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: metadata.originalId,
      });

      if (!data.data) {
        throw new Error('No attachment data received');
      }

      return {
        id: metadata.originalId,
        content: data.data,
        size: metadata.size,
        name: metadata.filename,
        mimeType: metadata.mimeType,
      };
    } catch (error) {
      throw new GmailError(
        'Failed to get attachment',
        'ATTACHMENT_ERROR',
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate attachment content and size
   */
  validateAttachment(attachment: OutgoingGmailAttachment): void {
    if (!attachment.content) {
      throw new GmailError(
        'Invalid attachment',
        'VALIDATION_ERROR',
        'Attachment content is required'
      );
    }

    // Gmail's attachment size limit is 25MB
    const MAX_SIZE = 25 * 1024 * 1024;
    if (attachment.size > MAX_SIZE) {
      throw new GmailError(
        'Invalid attachment',
        'VALIDATION_ERROR',
        `Attachment size ${attachment.size} exceeds maximum allowed size ${MAX_SIZE}`
      );
    }
  }

  /**
   * Prepare attachment for sending
   */
  prepareAttachment(attachment: OutgoingGmailAttachment): {
    filename: string;
    mimeType: string;
    content: string;
  } {
    this.validateAttachment(attachment);
    
    return {
      filename: attachment.name,
      mimeType: attachment.mimeType,
      content: attachment.content,
    };
  }
}
