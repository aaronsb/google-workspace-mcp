import {
  AttachmentMetadata,
  AttachmentResult,
  AttachmentServiceConfig,
  AttachmentSource,
  AttachmentValidationResult,
  ATTACHMENT_FOLDERS,
  AttachmentFolderType
} from './types.js';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_CONFIG: AttachmentServiceConfig = {
  maxSizeBytes: 25 * 1024 * 1024, // 25MB
  allowedMimeTypes: ['*/*'],
  quotaLimitBytes: 1024 * 1024 * 1024, // 1GB
  basePath: process.env.WORKSPACE_BASE_PATH ? 
    path.join(process.env.WORKSPACE_BASE_PATH, ATTACHMENT_FOLDERS.ROOT) : 
    '/app/workspace/attachments'
};

export class AttachmentService {
  private static instance: AttachmentService;
  private config: AttachmentServiceConfig;
  private initialized = false;

  private constructor(config: AttachmentServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(config: AttachmentServiceConfig = {}): AttachmentService {
    if (!AttachmentService.instance) {
      AttachmentService.instance = new AttachmentService(config);
    }
    return AttachmentService.instance;
  }

  /**
   * Initialize attachment folders in local storage
   */
  async initialize(email: string): Promise<void> {
    try {
      // Create base attachment directory
      await fs.mkdir(this.config.basePath!, { recursive: true });

      // Create email directory structure
      const emailPath = path.join(this.config.basePath!, ATTACHMENT_FOLDERS.EMAIL);
      await fs.mkdir(emailPath, { recursive: true });
      await fs.mkdir(path.join(emailPath, ATTACHMENT_FOLDERS.INCOMING), { recursive: true });
      await fs.mkdir(path.join(emailPath, ATTACHMENT_FOLDERS.OUTGOING), { recursive: true });

      // Create calendar directory structure
      const calendarPath = path.join(this.config.basePath!, ATTACHMENT_FOLDERS.CALENDAR);
      await fs.mkdir(calendarPath, { recursive: true });
      await fs.mkdir(path.join(calendarPath, ATTACHMENT_FOLDERS.EVENT_FILES), { recursive: true });

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize attachment directories: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
   * Process attachment and store in local filesystem
   */
  async processAttachment(
    email: string,
    source: AttachmentSource,
    parentFolder: string
  ): Promise<AttachmentResult> {
    if (!this.initialized) {
      await this.initialize(email);
    }

    // Validate attachment
    const validation = this.validateAttachment(source);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }

    try {
      if (!source.content) {
        throw new Error('File content not provided');
      }

      // Generate unique ID and create file path
      const id = uuidv4();
      const folderPath = path.join(this.config.basePath!, parentFolder);
      const filePath = path.join(folderPath, `${id}_${source.metadata.name}`);

      // Write file content
      const content = Buffer.from(source.content, 'base64');
      await fs.writeFile(filePath, content);

      // Get actual file size
      const stats = await fs.stat(filePath);

      return {
        success: true,
        attachment: {
          id,
          name: source.metadata.name,
          mimeType: source.metadata.mimeType,
          size: stats.size,
          path: filePath
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
   * Download attachment from local storage
   */
  async downloadAttachment(
    email: string,
    attachmentId: string,
    filePath: string
  ): Promise<AttachmentResult> {
    if (!this.initialized) {
      await this.initialize(email);
    }

    try {
      // Verify file exists and is within workspace
      if (!filePath.startsWith(this.config.basePath!)) {
        throw new Error('Invalid file path');
      }

      const content = await fs.readFile(filePath);
      const stats = await fs.stat(filePath);

      return {
        success: true,
        attachment: {
          id: attachmentId,
          name: path.basename(filePath).substring(37), // Remove UUID prefix
          mimeType: path.extname(filePath) ? 
            `application/${path.extname(filePath).substring(1)}` : 
            'application/octet-stream',
          size: stats.size,
          path: filePath
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
   * Delete attachment from local storage
   */
  async deleteAttachment(
    email: string,
    attachmentId: string,
    filePath: string
  ): Promise<AttachmentResult> {
    if (!this.initialized) {
      await this.initialize(email);
    }

    try {
      // Verify file exists and is within workspace
      if (!filePath.startsWith(this.config.basePath!)) {
        throw new Error('Invalid file path');
      }

      // Get file stats before deletion
      const stats = await fs.stat(filePath);
      const name = path.basename(filePath).substring(37); // Remove UUID prefix
      const mimeType = path.extname(filePath) ? 
        `application/${path.extname(filePath).substring(1)}` : 
        'application/octet-stream';

      // Delete the file
      await fs.unlink(filePath);

      return {
        success: true,
        attachment: {
          id: attachmentId,
          name,
          mimeType,
          size: stats.size,
          path: filePath
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
   * Get full path for a specific attachment category
   */
  getAttachmentPath(folder: AttachmentFolderType): string {
    return path.join(this.config.basePath!, folder);
  }
}
