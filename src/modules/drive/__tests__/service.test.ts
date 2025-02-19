import { DriveService } from '../service.js';
import { getAccountManager } from '../../accounts/index.js';
import { DRIVE_SCOPES } from '../scopes.js';
import { GoogleServiceError } from '../../../services/base/BaseGoogleService.js';

jest.mock('../../accounts/index.js');
jest.mock('googleapis', () => ({
  google: {
    drive: jest.fn(() => ({
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
    }))
  }
}));

describe('DriveService', () => {
  const testEmail = 'test@example.com';
  let service: DriveService;
  let mockDrive: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock account manager
    (getAccountManager as jest.Mock).mockReturnValue({
      validateToken: jest.fn().mockResolvedValue({
        valid: true,
        token: { access_token: 'test-token' },
        requiredScopes: Object.values(DRIVE_SCOPES)
      })
    });

    // Get mock drive instance
    const { google } = require('googleapis');
    mockDrive = google.drive();
    
    service = new DriveService();
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
          mimeType: 'text/plain'
        }
      };

      mockDrive.files.create.mockResolvedValue(mockResponse);

      const result = await service.uploadFile(testEmail, {
        name: 'test.txt',
        content: 'test content'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.files.create).toHaveBeenCalled();
    });
  });

  describe('downloadFile', () => {
    it('should download regular file successfully', async () => {
      const mockMetadata = {
        data: {
          mimeType: 'text/plain'
        }
      };

      const mockContent = {
        data: 'file content'
      };

      mockDrive.files.get
        .mockResolvedValueOnce(mockMetadata)
        .mockResolvedValueOnce(mockContent);

      const result = await service.downloadFile(testEmail, {
        fileId: '1'
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockContent.data);
    });

    it('should handle Google Workspace files', async () => {
      const mockMetadata = {
        data: {
          mimeType: 'application/vnd.google-apps.document'
        }
      };

      const mockContent = {
        data: 'exported content'
      };

      mockDrive.files.get.mockResolvedValue(mockMetadata);
      mockDrive.files.export.mockResolvedValue(mockContent);

      const result = await service.downloadFile(testEmail, {
        fileId: '1'
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockContent.data);
      expect(result.mimeType).toBe('text/markdown');
    });
  });

  describe('createFolder', () => {
    it('should create folder successfully', async () => {
      const mockResponse = {
        data: {
          id: '1',
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder'
        }
      };

      mockDrive.files.create.mockResolvedValue(mockResponse);

      const result = await service.createFolder(testEmail, 'Test Folder');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResponse.data);
      expect(mockDrive.files.create).toHaveBeenCalledWith(expect.objectContaining({
        requestBody: {
          name: 'Test Folder',
          mimeType: 'application/vnd.google-apps.folder'
        }
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
      expect(mockDrive.permissions.create).toHaveBeenCalled();
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
  });
});
