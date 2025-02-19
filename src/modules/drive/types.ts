import { drive_v3 } from 'googleapis';

export type DriveFile = drive_v3.Schema$File;
export type DriveFileList = drive_v3.Schema$FileList;
export type DrivePermission = drive_v3.Schema$Permission;

export interface FileUploadOptions {
  name: string;
  mimeType?: string;
  parents?: string[];
  content: string | Buffer;
}

export interface FileDownloadOptions {
  fileId: string;
  mimeType?: string;
}

export interface FileListOptions {
  folderId?: string;
  query?: string;
  pageSize?: number;
  orderBy?: string[];
  fields?: string[];
}

export interface FileSearchOptions extends FileListOptions {
  fullText?: string;
  mimeType?: string;
  trashed?: boolean;
}

export interface PermissionOptions {
  fileId: string;
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  type: 'user' | 'group' | 'domain' | 'anyone';
  emailAddress?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
}

export interface DriveOperationResult {
  success: boolean;
  data?: any;
  error?: string;
  mimeType?: string;  // For downloaded/exported files
}
