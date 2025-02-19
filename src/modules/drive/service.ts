import { drive_v3, google } from 'googleapis';
import { GoogleServiceError, BaseGoogleService } from '../../services/base/BaseGoogleService.js';
import { DriveFile, DriveFileList, DriveOperationResult, FileDownloadOptions, FileListOptions, FileSearchOptions, FileUploadOptions, PermissionOptions } from './types.js';
import { Readable } from 'stream';
import { DRIVE_SCOPES } from './scopes.js';

export class DriveService extends BaseGoogleService<drive_v3.Drive> {
  constructor() {
    super({
      serviceName: 'Google Drive',
      version: 'v3'
    });
  }

  async listFiles(email: string, options: FileListOptions = {}): Promise<DriveOperationResult> {
    try {
      await this.validateScopes(email, [DRIVE_SCOPES.READONLY]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      const query = [];
      if (options.folderId) {
        query.push(`'${options.folderId}' in parents`);
      }
      if (options.query) {
        query.push(options.query);
      }

      const response = await client.files.list({
        q: query.join(' and ') || undefined,
        pageSize: options.pageSize,
        orderBy: options.orderBy?.join(','),
        fields: options.fields?.join(',') || 'files(id, name, mimeType, modifiedTime, size)',
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async uploadFile(email: string, options: FileUploadOptions): Promise<DriveOperationResult> {
    try {
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      const media = {
        mimeType: options.mimeType || 'application/octet-stream',
        body: Readable.from([options.content]),
      };

      const response = await client.files.create({
        requestBody: {
          name: options.name,
          mimeType: options.mimeType,
          parents: options.parents,
        },
        media,
        fields: 'id, name, mimeType, webViewLink',
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async downloadFile(email: string, options: FileDownloadOptions): Promise<DriveOperationResult> {
    try {
      await this.validateScopes(email, [DRIVE_SCOPES.READONLY]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      // First get file metadata to check mime type
      const file = await client.files.get({
        fileId: options.fileId,
        fields: 'mimeType',
      });

      // Handle Google Workspace files differently
      if (file.data.mimeType?.startsWith('application/vnd.google-apps')) {
        let exportMimeType = options.mimeType || 'text/plain';
        
        // Default export formats if not specified
        if (!options.mimeType) {
          switch (file.data.mimeType) {
            case 'application/vnd.google-apps.document':
              exportMimeType = 'text/markdown';
              break;
            case 'application/vnd.google-apps.spreadsheet':
              exportMimeType = 'text/csv';
              break;
            case 'application/vnd.google-apps.presentation':
              exportMimeType = 'text/plain';
              break;
            case 'application/vnd.google-apps.drawing':
              exportMimeType = 'image/png';
              break;
          }
        }

        const response = await client.files.export(
          { fileId: options.fileId, mimeType: exportMimeType },
          { responseType: 'arraybuffer' }
        );

        return {
          success: true,
          data: response.data,
          mimeType: exportMimeType
        };
      }

      // For regular files
      const response = await client.files.get({
        fileId: options.fileId,
        alt: 'media',
      }, {
        responseType: 'arraybuffer',
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async createFolder(email: string, name: string, parentId?: string): Promise<DriveOperationResult> {
    try {
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      const response = await client.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentId ? [parentId] : undefined,
        },
        fields: 'id, name, mimeType, webViewLink',
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async searchFiles(email: string, options: FileSearchOptions): Promise<DriveOperationResult> {
    try {
      await this.validateScopes(email, [DRIVE_SCOPES.READONLY]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      const query = [];
      
      if (options.fullText) {
        const escapedQuery = options.fullText.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        query.push(`fullText contains '${escapedQuery}'`);
      }
      if (options.mimeType) {
        query.push(`mimeType = '${options.mimeType}'`);
      }
      if (options.folderId) {
        query.push(`'${options.folderId}' in parents`);
      }
      if (options.trashed !== undefined) {
        query.push(`trashed = ${options.trashed}`);
      }
      if (options.query) {
        query.push(options.query);
      }

      const response = await client.files.list({
        q: query.join(' and ') || undefined,
        pageSize: options.pageSize,
        orderBy: options.orderBy?.join(','),
        fields: options.fields?.join(',') || 'files(id, name, mimeType, modifiedTime, size)',
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async updatePermissions(email: string, options: PermissionOptions): Promise<DriveOperationResult> {
    try {
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      const response = await client.permissions.create({
        fileId: options.fileId,
        requestBody: {
          role: options.role,
          type: options.type,
          emailAddress: options.emailAddress,
          domain: options.domain,
          allowFileDiscovery: options.allowFileDiscovery,
        },
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  async deleteFile(email: string, fileId: string): Promise<DriveOperationResult> {
    try {
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      await client.files.delete({
        fileId,
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
