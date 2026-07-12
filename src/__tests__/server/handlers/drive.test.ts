import { vi, beforeEach, describe, expect, it } from 'vitest';

// Registered here, not in the shared helper: vi.mock hoists per-file.
// BOTH seams are mocked: `search`/`get` are resource ops and go through the
// client; `upload` is still a gws helper (+upload) and goes through execute.
vi.mock('../../../executor/gws.js');
vi.mock('../../../google/client.js');
import { mockExecute, mockGwsResponse } from './__mocks__/executor.js';
import { mockCall } from './__mocks__/client.js';
import {
  driveFileListResponse, driveFileDetailResponse, driveUploadResponse,
} from './__mocks__/fixtures.js';
import { handleDrive } from '../../../server/handlers/drive.js';

describe('handleDrive', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCall.mockReset();
  });

  it('rejects missing email', async () => {
    await expect(handleDrive({ operation: 'search' })).rejects.toThrow('valid email');
  });

  describe('search', () => {
    it('returns markdown file list', async () => {
      mockCall.mockResolvedValue(driveFileListResponse);
      const result = await handleDrive({ operation: 'search', email: 'user@test.com' });

      expect(result.text).toContain('## Files (2)');
      expect(result.text).toContain('report.pdf');
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBe(2);
    });

    it('passes query to drive.files.list', async () => {
      mockCall.mockResolvedValue(driveFileListResponse);
      await handleDrive({ operation: 'search', email: 'user@test.com', query: "name contains 'report'" });

      expect(mockCall).toHaveBeenCalledWith(
        'drive',
        'files.list',
        expect.objectContaining({ q: "name contains 'report'" }),
        expect.objectContaining({ account: 'user@test.com' }),
      );
    });

    it('clamps maxResults to 50', async () => {
      mockCall.mockResolvedValue(driveFileListResponse);
      await handleDrive({ operation: 'search', email: 'user@test.com', maxResults: 999 });

      expect(mockCall.mock.calls[0][2].pageSize).toBe(50);
    });
  });

  describe('get', () => {
    it('requires fileId', async () => {
      await expect(handleDrive({ operation: 'get', email: 'user@test.com' })).rejects.toThrow('fileId');
    });

    it('returns markdown file detail', async () => {
      mockCall.mockResolvedValue(driveFileDetailResponse);
      const result = await handleDrive({ operation: 'get', email: 'user@test.com', fileId: 'file-1' });

      expect(mockCall).toHaveBeenCalledWith(
        'drive',
        'files.get',
        expect.objectContaining({ fileId: 'file-1' }),
        expect.objectContaining({ account: 'user@test.com' }),
      );
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

  it('rejects unknown operation (including removed download)', async () => {
    await expect(handleDrive({ operation: 'download', email: 'user@test.com' })).rejects.toThrow('Unknown');
    await expect(handleDrive({ operation: 'nope', email: 'user@test.com' })).rejects.toThrow('Unknown');
  });
});
