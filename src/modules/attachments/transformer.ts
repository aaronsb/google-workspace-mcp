import { AttachmentIndexService } from './index-service.js';

/**
 * Simplified attachment information visible to AI
 */
export interface AttachmentInfo {
  name: string;
}

/**
 * Transform attachment data for AI consumption while storing full metadata
 */
export class AttachmentTransformer {
  constructor(private indexService: AttachmentIndexService) {}

  /**
   * Transform attachments for a message, storing metadata and returning simplified format
   */
  transformAttachments(messageId: string, attachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
  }>): AttachmentInfo[] {
    // Store full metadata for each attachment
    attachments.forEach(attachment => {
      this.indexService.addAttachment(messageId, attachment);
    });

    // Return simplified format for AI
    return attachments.map(attachment => ({
      name: attachment.name
    }));
  }

  /**
   * Create a refresh placeholder when attachments have expired
   */
  static createRefreshPlaceholder(): AttachmentInfo[] {
    return [{
      name: "Attachments expired - Request message again to view"
    }];
  }
}
