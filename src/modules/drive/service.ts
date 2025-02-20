import { google } from 'googleapis';
import { BaseGoogleService } from '../../services/base/BaseGoogleService.js';
import { DriveOperationResult, FileDownloadOptions, FileListOptions, FileSearchOptions, FileUploadOptions, PermissionOptions } from './types.js';
import { Readable } from 'stream';
import { DRIVE_SCOPES } from './scopes.js';
import { workspaceManager } from '../../utils/workspace.js';
import fs from 'fs/promises';
import { GaxiosResponse } from 'gaxios';

export class DriveService extends BaseGoogleService<ReturnType<typeof google.drive>> {
  private initialized = false;

  constructor() {
    super({
      serviceName: 'Google Drive',
      version: 'v3'
    });
  }

  /**
   * Initialize the Drive service and all dependencies
   */
  public async initialize(): Promise<void> {
    try {
      await super.initialize();
      this.initialized = true;
    } catch (error) {
      throw this.handleError(error, 'Failed to initialize Drive service');
    }
  }

  /**
   * Ensure the Drive service is initialized
   */
  public async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Check if the service is initialized
   */
  private checkInitialized(): void {
    if (!this.initialized) {
      throw this.handleError(
        new Error('Drive service not initialized'),
        'Please ensure the service is initialized before use'
      );
    }
  }

  async listFiles(email: string, options: FileListOptions = {}): Promise<DriveOperationResult> {
    try {
      await this.ensureInitialized();
      this.checkInitialized();
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
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
      await this.ensureInitialized();
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      // Save content to workspace first
      const uploadPath = await workspaceManager.getUploadPath(email, options.name);
      await fs.writeFile(uploadPath, options.content);

      const fileContent = await fs.readFile(uploadPath);
      const media = {
        mimeType: options.mimeType || 'application/octet-stream',
        body: Readable.from([fileContent]),
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
      await this.ensureInitialized();
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
      const client = await this.getAuthenticatedClient(
        email,
        (auth) => google.drive({ version: 'v3', auth })
      );

      // First get file metadata to check mime type and name
      const file = await client.files.get({
        fileId: options.fileId,
        fields: 'name,mimeType',
      });

      const fileName = file.data.name || options.fileId;

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

        const response = await client.files.export({
          fileId: options.fileId,
          mimeType: exportMimeType
        }, {
          responseType: 'arraybuffer'
        }) as unknown as GaxiosResponse<Uint8Array>;

        const downloadPath = await workspaceManager.getDownloadPath(email, fileName);
        await fs.writeFile(downloadPath, Buffer.from(response.data));

        return {
          success: true,
          data: response.data,
          mimeType: exportMimeType,
          filePath: downloadPath
        };
      }

      // For regular files
      const response = await client.files.get({
        fileId: options.fileId,
        alt: 'media'
      }, {
        responseType: 'arraybuffer'
      }) as unknown as GaxiosResponse<Uint8Array>;

      const downloadPath = await workspaceManager.getDownloadPath(email, fileName);
      await fs.writeFile(downloadPath, Buffer.from(response.data));

      return {
        success: true,
        data: response.data,
        filePath: downloadPath
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
      await this.ensureInitialized();
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
      await this.ensureInitialized();
      await this.validateScopes(email, [DRIVE_SCOPES.FILE]);
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
      await this.ensureInitialized();
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
      await this.ensureInitialized();
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
