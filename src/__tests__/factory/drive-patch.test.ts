/**
 * Tests for the drive service patch — custom handlers for download/export
 * that ensure parent directories are created before writing files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock executor before importing patch
jest.mock('../../executor/gws.js');
import { execute } from '../../executor/gws.js';

// Mock workspace module with a temp dir
const tmpWorkspace = path.join(os.tmpdir(), `gws-test-${Date.now()}`);
jest.mock('../../executor/workspace.js', () => ({
  ensureWorkspaceDir: jest.fn(async () => ({ path: tmpWorkspace, valid: true })),
  getWorkspaceDir: jest.fn(() => tmpWorkspace),
  resolveWorkspacePath: jest.fn((filename: string) => path.join(tmpWorkspace, filename)),
  verifyPathSafety: jest.fn(async () => {}),
}));

// Mock file-output to avoid reading actual files
jest.mock('../../executor/file-output.js', () => ({
  isTextFile: jest.fn(() => true),
  isImageFile: jest.fn(() => false),
  formatFileOutput: jest.fn(() => '## Exported file\n'),
  buildImageBlock: jest.fn(() => null),
  buildImageBlockFromFile: jest.fn(() => null),
}));

import { drivePatch } from '../../services/drive/patch.js';

const mockExecute = execute as jest.MockedFunction<typeof execute>;

describe('drivePatch custom handlers', () => {
  beforeEach(async () => {
    mockExecute.mockReset();
    await fs.mkdir(tmpWorkspace, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  });

  describe('export', () => {
    it('creates parent directories before calling gws', async () => {
      // First call: get file metadata; second call: export
      mockExecute
        .mockResolvedValueOnce({ success: true, data: { name: 'Report.gdoc' }, stderr: '' })
        .mockResolvedValueOnce({ success: true, data: {}, stderr: '' });

      // Write a dummy file so readWorkspaceFile finds something
      const outputPath = path.join(tmpWorkspace, 'subdir', 'Report.txt');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, 'exported content');

      const { resolveWorkspacePath } = require('../../executor/workspace.js');
      (resolveWorkspacePath as jest.Mock).mockReturnValue(outputPath);

      const handler = drivePatch.customHandlers!.export!;
      await handler(
        { fileId: 'abc123', mimeType: 'text/plain', outputPath: 'subdir/Report.txt' },
        'user@test.com',
      );

      // The export call (second execute) should have --output pointing to the nested path
      const exportCall = mockExecute.mock.calls[1][0];
      expect(exportCall).toContain('--output');
      expect(exportCall[exportCall.indexOf('--output') + 1]).toBe(outputPath);

      // Parent directory must exist (we created it, but the handler also calls mkdir)
      const parentExists = await fs.stat(path.dirname(outputPath)).then(() => true).catch(() => false);
      expect(parentExists).toBe(true);
    });

    it('works with flat filename (no subdirectory)', async () => {
      mockExecute
        .mockResolvedValueOnce({ success: true, data: { name: 'Doc' }, stderr: '' })
        .mockResolvedValueOnce({ success: true, data: {}, stderr: '' });

      const outputPath = path.join(tmpWorkspace, 'Doc.pdf');
      await fs.writeFile(outputPath, 'pdf content');

      const { resolveWorkspacePath } = require('../../executor/workspace.js');
      (resolveWorkspacePath as jest.Mock).mockReturnValue(outputPath);

      const handler = drivePatch.customHandlers!.export!;
      const result = await handler(
        { fileId: 'abc123', mimeType: 'application/pdf' },
        'user@test.com',
      );

      expect(result.text).toBeDefined();
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  describe('download', () => {
    it('creates parent directories before calling gws', async () => {
      mockExecute
        .mockResolvedValueOnce({ success: true, data: { name: 'photo.png', mimeType: 'image/png' }, stderr: '' })
        .mockResolvedValueOnce({ success: true, data: {}, stderr: '' });

      const outputPath = path.join(tmpWorkspace, 'images', 'photo.png');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, 'png data');

      const { resolveWorkspacePath } = require('../../executor/workspace.js');
      (resolveWorkspacePath as jest.Mock).mockReturnValue(outputPath);

      const handler = drivePatch.customHandlers!.download!;
      await handler(
        { fileId: 'img-1', outputPath: 'images/photo.png' },
        'user@test.com',
      );

      const downloadCall = mockExecute.mock.calls[1][0];
      expect(downloadCall).toContain('--output');
      expect(downloadCall[downloadCall.indexOf('--output') + 1]).toBe(outputPath);
    });
  });
});
