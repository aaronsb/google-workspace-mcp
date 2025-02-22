import { AttachmentIndexService } from './index-service.js';

/**
 * Simplified attachment information visible to AI
 */
export interface AttachmentInfo {
  name: string;
}

/**
 * Service for transforming API responses to hide complex attachment IDs from AI
 */
export class AttachmentResponseTransformer {
  constructor(private indexService: AttachmentIndexService) {}

  /**
   * Transform a response object that may contain attachments
   * Works with both email and calendar responses
   */
  /**
   * Transform a response object that may contain attachments
   * Works with both email and calendar responses
   */
  transformResponse<T>(response: T): T {
    if (Array.isArray(response)) {
      return response.map(item => this.transformResponse(item)) as unknown as T;
    }

    if (typeof response !== 'object' || response === null) {
      return response;
    }

    // Deep clone to avoid modifying original
    const transformed = { ...response } as Record<string, any>;

    // Transform attachments if present
    if ('attachments' in transformed && 
        Array.isArray(transformed.attachments) && 
        'id' in transformed) {
      const messageId = transformed.id as string;
      
      // Store full metadata in index
      transformed.attachments.forEach((attachment: any) => {
        if (attachment?.id && attachment?.name) {
          this.indexService.addAttachment(messageId, {
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType || 'application/octet-stream',
            size: attachment.size || 0
          });
        }
      });

      // Replace with simplified version
      transformed.attachments = transformed.attachments.map((attachment: any) => ({
        name: attachment?.name || 'Unknown file'
      }));
    }

    // Recursively transform nested objects
    Object.keys(transformed).forEach(key => {
      if (typeof transformed[key] === 'object' && transformed[key] !== null) {
        transformed[key] = this.transformResponse(transformed[key]);
      }
    });

    return transformed as unknown as T;
  }

  /**
   * Create a refresh placeholder for expired attachments
   */
  static createRefreshPlaceholder(): AttachmentInfo[] {
    return [{
      name: "Attachments expired - Request message again to view"
    }];
  }
}
