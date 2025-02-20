import { DriveService } from '../service.js';
import { getAccountManager } from '../../accounts/index.js';
import { DRIVE_SCOPES } from '../scopes.js';
import { GoogleServiceError } from '../../../services/base/BaseGoogleService.js';
import { mockFileSystem } from '../../../__helpers__/testSetup.js';

jest.mock('../../accounts/index.js');
jest.mock('googleapis');
jest.mock('../../../utils/workspace.js', () => ({
  workspaceManager: {
    getUploadPath: jest.fn().mockResolvedValue('/tmp/test-upload.txt'),
    getDownloadPath: jest.fn().mockResolvedValue('/tmp/test-download.txt'),
    initializeAccountDirectories: jest.fn().mockResolvedValue(undefined)
  }
}));

const { fs } = mockFileSystem();

describe('DriveService', () => {
  const testEmail = 'test@example.com';
  let service: DriveService;
  let mockDrive: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock file system operations
    fs.writeFile.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue(Buffer.from('test content'));
    
    // Mock account manager
    (getAccountManager as jest.Mock).mockReturnValue({
      validateToken: jest.fn().mockResolvedValue({
        valid: true,
        token: { access_token: 'test-token' },
        requiredScopes: Object.values(DRIVE_SCOPES)
      }),
      getAuthClient: jest.fn().mockResolvedValue({
        setCredentials: jest.fn()
      })
    });

    const { google } = require('googleapis');
    mockDrive = {
      files: {
        list: jest.fn(),
        create: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
        export: jest.fn()
      },
      permissions: {
        create: jest.fn()
      }
    };
    google.drive.mockReturnValue(mockDrive);
    
    service = new DriveService();
    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  describe('listFiles', () => {
    it('should list files successfully', async () => {
      const mockResponse = {
        data: {
          files: [
            { id: '1', name: 'test.txt' }
          ]
        }
      };

      mockDrive.files.list.mockResolvedValue(mockResponse);

      const result = await service.listFiles(testEmail);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.files.list).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      mockDrive.files.list.mockRejectedValue(new Error('API error'));

      const result = await service.listFiles(testEmail);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
    });
  });

  describe('uploadFile', () => {
    it('should upload file successfully', async () => {
      const mockResponse = {
        data: {
          id: '1',
          name: 'test.txt',
          mimeType: 'text/plain',
          webViewLink: 'https://drive.google.com/file/d/1'
        }
      };

      mockDrive.files.create.mockResolvedValue(mockResponse);

      const result = await service.uploadFile(testEmail, {
        name: 'test.txt',
        content: 'test content',
        mimeType: 'text/plain'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.files.create).toHaveBeenCalledWith(expect.objectContaining({
        requestBody: {
          name: 'test.txt',
          mimeType: 'text/plain'
        },
        fields: 'id, name, mimeType, webViewLink'
      }));
    });

    it('should handle upload errors', async () => {
      mockDrive.files.create.mockRejectedValue(new Error('Upload failed'));

      const result = await service.uploadFile(testEmail, {
        name: 'test.txt',
        content: 'test content'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Upload failed');
    });
  });

  describe('downloadFile', () => {
    it('should download regular file successfully', async () => {
      const mockMetadata = {
        data: {
          name: 'test.txt',
          mimeType: 'text/plain'
        }
      };

      const mockContent = {
        data: Buffer.from('file content')
      };

      mockDrive.files.get
        .mockResolvedValueOnce(mockMetadata) // First call for metadata
        .mockResolvedValueOnce(mockContent); // Second call for content

      const result = await service.downloadFile(testEmail, {
        fileId: '1'
      });

      expect(result.success).toBe(true);
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.filePath).toBeDefined();
    });

    it('should handle Google Workspace files', async () => {
      const mockMetadata = {
        data: {
          name: 'test.doc',
          mimeType: 'application/vnd.google-apps.document'
        }
      };

      const mockContent = {
        data: Buffer.from('exported content')
      };

      mockDrive.files.get.mockResolvedValue(mockMetadata);
      mockDrive.files.export.mockResolvedValue(mockContent);

      const result = await service.downloadFile(testEmail, {
        fileId: '1'
      });

      expect(result.success).toBe(true);
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.mimeType).toBe('text/markdown');
      expect(result.filePath).toBeDefined();
    });

    it('should handle download errors', async () => {
      mockDrive.files.get.mockRejectedValue(new Error('Download failed'));

      const result = await service.downloadFile(testEmail, {
        fileId: '1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Download failed');
    });
  });

  describe('searchFiles', () => {
    it('should search files successfully', async () => {
      const mockResponse = {
        data: {
          files: [
            { 
              id: '1', 
              name: 'test.txt',
              mimeType: 'text/plain',
              modifiedTime: '2024-02-19T12:00:00Z',
              size: '1024'
            }
          ]
        }
      };

      mockDrive.files.list.mockResolvedValue(mockResponse);

      const result = await service.searchFiles(testEmail, {
        fullText: 'test',
        mimeType: 'text/plain',
        trashed: false
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.files.list).toHaveBeenCalledWith(expect.objectContaining({
        q: "fullText contains 'test' and mimeType = 'text/plain' and trashed = false",
        fields: 'files(id, name, mimeType, modifiedTime, size)'
      }));
    });

    it('should handle search errors', async () => {
      mockDrive.files.list.mockRejectedValue(new Error('Search failed'));

      const result = await service.searchFiles(testEmail, {
        fullText: 'test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Search failed');
    });

    it('should handle folder-specific search', async () => {
      const mockResponse = {
        data: {
          files: [
            { id: '1', name: 'test.txt' }
          ]
        }
      };

      mockDrive.files.list.mockResolvedValue(mockResponse);

      const result = await service.searchFiles(testEmail, {
        folderId: 'folder123',
        query: "name contains 'test'"
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.files.list).toHaveBeenCalledWith(expect.objectContaining({
        q: "'folder123' in parents and name contains 'test'"
      }));
    });
  });

  describe('updatePermissions', () => {
    it('should update permissions successfully', async () => {
      const mockResponse = {
        data: {
          id: '1',
          type: 'user',
          role: 'reader'
        }
      };

      mockDrive.permissions.create.mockResolvedValue(mockResponse);

      const result = await service.updatePermissions(testEmail, {
        fileId: '1',
        type: 'user',
        role: 'reader',
        emailAddress: 'user@example.com'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.permissions.create).toHaveBeenCalledWith({
        fileId: '1',
        requestBody: {
          role: 'reader',
          type: 'user',
          emailAddress: 'user@example.com'
        }
      });
    });

    it('should handle permission update errors', async () => {
      mockDrive.permissions.create.mockRejectedValue(new Error('Permission update failed'));

      const result = await service.updatePermissions(testEmail, {
        fileId: '1',
        type: 'user',
        role: 'reader',
        emailAddress: 'user@example.com'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission update failed');
    });
  });

  describe('deleteFile', () => {
    it('should delete file successfully', async () => {
      mockDrive.files.delete.mockResolvedValue({});

      const result = await service.deleteFile(testEmail, '1');

      expect(result.success).toBe(true);
      expect(mockDrive.files.delete).toHaveBeenCalledWith({
        fileId: '1'
      });
    });

    it('should handle delete errors', async () => {
      mockDrive.files.delete.mockRejectedValue(new Error('Delete failed'));

      const result = await service.deleteFile(testEmail, '1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
    });
  });

  describe('createFolder', () => {
    it('should create folder successfully', async () => {
      const mockResponse = {
        data: {
          id: '1',
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder',
          webViewLink: 'https://drive.google.com/drive/folders/1'
        }
      };

      mockDrive.files.create.mockResolvedValue(mockResponse);

      const result = await service.createFolder(testEmail, 'Test Folder', 'parent123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.files.create).toHaveBeenCalledWith({
        requestBody: {
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['parent123']
        },
        fields: 'id, name, mimeType, webViewLink'
      });
    });

    it('should handle folder creation errors', async () => {
      mockDrive.files.create.mockRejectedValue(new Error('Folder creation failed'));

      const result = await service.createFolder(testEmail, 'Test Folder');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Folder creation failed');
    });
  });
});
