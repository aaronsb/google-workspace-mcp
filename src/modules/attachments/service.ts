import { DriveService } from '../drive/service.js';
import { workspaceManager } from '../../utils/workspace.js';
import {
  AttachmentMetadata,
  AttachmentResult,
  AttachmentServiceConfig,
  AttachmentSource,
  AttachmentValidationResult,
  ATTACHMENT_FOLDERS
} from './types.js';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_CONFIG: AttachmentServiceConfig = {
  maxSizeBytes: 25 * 1024 * 1024, // 25MB
  allowedMimeTypes: ['*/*'],
  quotaLimitBytes: 1024 * 1024 * 1024 // 1GB
};

export class AttachmentService {
  private driveService: DriveService;
  private config: AttachmentServiceConfig;
  private folderIds: Map<string, string> = new Map();

  constructor(driveService: DriveService, config: AttachmentServiceConfig = {}) {
    this.driveService = driveService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize attachment folders in Drive
   */
  async initialize(email: string): Promise<void> {
    // Create root folder if it doesn't exist
    const rootResult = await this.driveService.createFolder(
      email,
      ATTACHMENT_FOLDERS.ROOT
    );

    if (!rootResult.success || !rootResult.data?.id) {
      throw new Error('Failed to initialize attachment root folder');
    }

    const rootId = rootResult.data.id;
    this.folderIds.set(ATTACHMENT_FOLDERS.ROOT, rootId);

    // Create email attachments structure
    const emailResult = await this.driveService.createFolder(
      email,
      ATTACHMENT_FOLDERS.EMAIL,
      rootId
    );
    if (emailResult.success && emailResult.data?.id) {
      this.folderIds.set(ATTACHMENT_FOLDERS.EMAIL, emailResult.data.id);
      
      // Create incoming/outgoing subfolders
      const incomingResult = await this.driveService.createFolder(
        email,
        ATTACHMENT_FOLDERS.INCOMING,
        emailResult.data.id
      );
      if (incomingResult.success && incomingResult.data?.id) {
        this.folderIds.set(ATTACHMENT_FOLDERS.INCOMING, incomingResult.data.id);
      }

      const outgoingResult = await this.driveService.createFolder(
        email,
        ATTACHMENT_FOLDERS.OUTGOING,
        emailResult.data.id
      );
      if (outgoingResult.success && outgoingResult.data?.id) {
        this.folderIds.set(ATTACHMENT_FOLDERS.OUTGOING, outgoingResult.data.id);
      }
    }

    // Create calendar attachments structure
    const calendarResult = await this.driveService.createFolder(
      email,
      ATTACHMENT_FOLDERS.CALENDAR,
      rootId
    );
    if (calendarResult.success && calendarResult.data?.id) {
      this.folderIds.set(ATTACHMENT_FOLDERS.CALENDAR, calendarResult.data.id);
      
      // Create event files subfolder
      const eventFilesResult = await this.driveService.createFolder(
        email,
        ATTACHMENT_FOLDERS.EVENT_FILES,
        calendarResult.data.id
      );
      if (eventFilesResult.success && eventFilesResult.data?.id) {
        this.folderIds.set(ATTACHMENT_FOLDERS.EVENT_FILES, eventFilesResult.data.id);
      }
    }
  }

  /**
   * Validate attachment against configured limits
   */
  private validateAttachment(source: AttachmentSource): AttachmentValidationResult {
    // Check size if available
    if (source.metadata.size && this.config.maxSizeBytes) {
      if (source.metadata.size > this.config.maxSizeBytes) {
        return {
          valid: false,
          error: `File size ${source.metadata.size} exceeds maximum allowed size ${this.config.maxSizeBytes}`
        };
      }
    }

    // Check MIME type if restricted
    if (this.config.allowedMimeTypes && 
        this.config.allowedMimeTypes[0] !== '*/*' &&
        !this.config.allowedMimeTypes.includes(source.metadata.mimeType)) {
      return {
        valid: false,
        error: `MIME type ${source.metadata.mimeType} is not allowed`
      };
    }

    return { valid: true };
  }

  /**
   * Process attachment from source and store in Drive
   */
  async processAttachment(
    email: string,
    source: AttachmentSource,
    parentFolder: string
  ): Promise<AttachmentResult> {
    // Validate attachment
    const validation = this.validateAttachment(source);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    try {
      const parentId = this.folderIds.get(parentFolder);
      if (!parentId) {
        throw new Error(`Parent folder ${parentFolder} not initialized`);
      }

      if (source.type === 'drive') {
        // File already in Drive, just verify and return metadata
        if (!source.fileId) {
          throw new Error('Drive file ID not provided');
        }

        const fileResult = await this.driveService.downloadFile(email, {
          fileId: source.fileId
        });

        if (!fileResult.success) {
          throw new Error('Failed to verify Drive file');
        }

        return {
          success: true,
          attachment: {
            id: source.fileId,
            name: source.metadata.name,
            mimeType: source.metadata.mimeType,
            size: source.metadata.size || 0
          }
        };
      } else {
        // Upload new file from local content
        if (!source.content) {
          throw new Error('File content not provided');
        }

        const uploadResult = await this.driveService.uploadFile(email, {
          name: source.metadata.name,
          content: source.content,
          mimeType: source.metadata.mimeType,
          parents: [parentId]
        });

        if (!uploadResult.success || !uploadResult.data) {
          throw new Error('Failed to upload file to Drive');
        }

        return {
          success: true,
          attachment: {
            id: uploadResult.data.id!,
            name: uploadResult.data.name!,
            mimeType: uploadResult.data.mimeType!,
            size: source.metadata.size || 0,
            driveLink: uploadResult.data.webViewLink
          }
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Download attachment from Drive
   */
  async downloadAttachment(
    email: string,
    attachmentId: string
  ): Promise<AttachmentResult> {
    try {
      const result = await this.driveService.downloadFile(email, {
        fileId: attachmentId
      });

      if (!result.success) {
        throw new Error('Failed to download file from Drive');
      }

      return {
        success: true,
        attachment: {
          id: attachmentId,
          name: path.basename(result.filePath || ''),
          mimeType: result.mimeType || 'application/octet-stream',
          size: Buffer.from(result.data).length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get folder ID for a specific attachment category
   */
  getFolderId(folder: keyof typeof ATTACHMENT_FOLDERS): string | undefined {
    return this.folderIds.get(folder);
  }
}
