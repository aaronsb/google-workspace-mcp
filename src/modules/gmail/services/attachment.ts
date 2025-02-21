import { google } from 'googleapis';
import { 
  GmailAttachment,
  IncomingGmailAttachment,
  OutgoingGmailAttachment,
  GmailError 
} from '../types.js';

export class GmailAttachmentService {
  constructor(private gmailClient?: ReturnType<typeof google.gmail>) {}

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
    messageId: string,
    attachmentId: string
  ): Promise<IncomingGmailAttachment> {
    try {
      const client = this.ensureClient();
      const { data } = await client.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      });

      if (!data.data) {
        throw new Error('No attachment data received');
      }

      return {
        id: attachmentId,
        content: data.data,
        size: data.size || 0,
        // These will be set by the email service
        name: '',
        mimeType: '',
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
