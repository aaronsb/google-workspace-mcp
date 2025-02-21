export interface AttachmentMetadata {
  id: string;           // Unique identifier
  name: string;         // Original filename
  mimeType: string;     // MIME type
  size: number;         // File size in bytes
  path: string;         // Local filesystem path
}

export interface AttachmentSource {
  content: string;      // Base64 content
  metadata: {
    name: string;
    mimeType: string;
    size?: number;
  };
}

export interface AttachmentResult {
  success: boolean;
  attachment?: AttachmentMetadata;
  error?: string;
}

export interface AttachmentServiceConfig {
  maxSizeBytes?: number;                    // Maximum file size (default: 25MB)
  allowedMimeTypes?: string[];             // Allowed MIME types (default: all)
  basePath?: string;                       // Base path for attachments (default: WORKSPACE_BASE_PATH/attachments)
  quotaLimitBytes?: number;                // Storage quota limit
}

export interface AttachmentValidationResult {
  valid: boolean;
  error?: string;
}

// Folder structure constants
export type AttachmentFolderType = 'attachments' | 'email' | 'calendar' | 'incoming' | 'outgoing' | 'event-files';

export const ATTACHMENT_FOLDERS: Record<string, AttachmentFolderType> = {
  ROOT: 'attachments',
  EMAIL: 'email',
  CALENDAR: 'calendar',
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
  EVENT_FILES: 'event-files'
};
