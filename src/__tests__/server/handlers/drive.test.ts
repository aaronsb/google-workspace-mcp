import {
  mockExecute, mockGwsResponse,
  driveFileListResponse, driveFileDetailResponse, driveUploadResponse,
} from './__mocks__/executor.js';
import { handleDrive } from '../../../server/handlers/drive.js';

describe('handleDrive', () => {
  beforeEach(() => mockExecute.mockReset());

  it('rejects missing email', async () => {
    await expect(handleDrive({ operation: 'search' })).rejects.toThrow('valid email');
  });

  describe('search', () => {
    it('returns markdown file list', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(driveFileListResponse));
      const result = await handleDrive({ operation: 'search', email: 'user@test.com' });

      expect(result.text).toContain('## Files (2)');
      expect(result.text).toContain('report.pdf');
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBe(2);
    });

    it('passes query to gws', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(driveFileListResponse));
      await handleDrive({ operation: 'search', email: 'user@test.com', query: "name contains 'report'" });

      const args = mockExecute.mock.calls[0][0];
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.q).toBe("name contains 'report'");
    });

    it('clamps maxResults to 50', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(driveFileListResponse));
      await handleDrive({ operation: 'search', email: 'user@test.com', maxResults: 999 });

      const args = mockExecute.mock.calls[0][0];
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.pageSize).toBe(50);
    });
  });

  describe('get', () => {
    it('requires fileId', async () => {
      await expect(handleDrive({ operation: 'get', email: 'user@test.com' })).rejects.toThrow('fileId');
    });

    it('returns markdown file detail', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(driveFileDetailResponse));
      const result = await handleDrive({ operation: 'get', email: 'user@test.com', fileId: 'file-1' });

      expect(result.text).toContain('## report.pdf');
      expect(result.refs.fileId).toBe('file-1');
    });
  });

  describe('upload', () => {
    it('requires filePath', async () => {
      await expect(handleDrive({ operation: 'upload', email: 'user@test.com' })).rejects.toThrow('filePath');
    });

    it('calls gws drive +upload with path', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(driveUploadResponse));
      const result = await handleDrive({ operation: 'upload', email: 'user@test.com', filePath: '/tmp/doc.txt' });

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('+upload');
      expect(args).toContain('/tmp/doc.txt');
      expect(result.text).toContain('File uploaded');
    });

    it('passes optional name and parent', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(driveUploadResponse));
      await handleDrive({ operation: 'upload', email: 'user@test.com', filePath: '/tmp/f.txt', name: 'doc.txt', parentFolderId: 'folder-1' });

      const args = mockExecute.mock.calls[0][0];
      expect(args[args.indexOf('--name') + 1]).toBe('doc.txt');
      expect(args[args.indexOf('--parent') + 1]).toBe('folder-1');
    });
  });

  describe('download', () => {
    it('requires fileId', async () => {
      await expect(handleDrive({ operation: 'download', email: 'user@test.com' })).rejects.toThrow('fileId');
    });

    it('passes outputPath when provided', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse({}));
      const result = await handleDrive({ operation: 'download', email: 'user@test.com', fileId: 'file-1', outputPath: '/tmp/out.pdf' });

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('--output');
      expect(args[args.indexOf('--output') + 1]).toBe('/tmp/out.pdf');
      expect(result.text).toContain('File downloaded');
      expect(result.text).toContain('/tmp/out.pdf');
    });
  });

  it('rejects unknown operation', async () => {
    await expect(handleDrive({ operation: 'nope', email: 'user@test.com' })).rejects.toThrow('Unknown');
  });
});
