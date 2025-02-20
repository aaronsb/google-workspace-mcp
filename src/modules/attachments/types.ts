import { DriveFile } from '../drive/types.js';

export interface AttachmentMetadata {
  id: string;           // Drive file ID
  name: string;         // Original filename
  mimeType: string;     // MIME type
  size: number;         // File size in bytes
  driveLink?: string;   // Optional link to Drive file
}

export interface AttachmentSource {
  type: 'drive' | 'local';
  fileId?: string;      // Drive file ID if type is 'drive'
  content?: string;     // Base64 content if type is 'local'
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
  attachmentRoot?: string;                 // Root folder for attachments
  quotaLimitBytes?: number;                // Storage quota limit
}

export interface AttachmentValidationResult {
  valid: boolean;
  error?: string;
}

// Folder structure constants
export const ATTACHMENT_FOLDERS = {
  ROOT: 'MCP Attachments',
  EMAIL: 'email-attachments',
  CALENDAR: 'calendar-attachments',
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
  EVENT_FILES: 'event-files'
} as const;
