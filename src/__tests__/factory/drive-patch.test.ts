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
    // Start with a clean workspace — only the root dir exists
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
    await fs.mkdir(tmpWorkspace, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  });

  describe('export', () => {
    it('creates parent directories before calling gws', async () => {
      const outputPath = path.join(tmpWorkspace, 'subdir', 'Report.txt');

      const { resolveWorkspacePath } = require('../../executor/workspace.js');
      (resolveWorkspacePath as jest.Mock).mockReturnValue(outputPath);

      // First call: get file metadata
      // Second call: export — simulate gws writing the file
      mockExecute
        .mockResolvedValueOnce({ success: true, data: { name: 'Report.gdoc' }, stderr: '' })
        .mockImplementationOnce(async () => {
          // gws would write the file here — parent dir must already exist
          await fs.writeFile(outputPath, 'exported content');
          return { success: true, data: {}, stderr: '' };
        });

      const handler = drivePatch.customHandlers!.export!;
      await handler(
        { fileId: 'abc123', mimeType: 'text/plain', outputPath: 'subdir/Report.txt' },
        'user@test.com',
      );

      // The export call should have --output pointing to the nested path
      const exportCall = mockExecute.mock.calls[1][0];
      expect(exportCall).toContain('--output');
      expect(exportCall[exportCall.indexOf('--output') + 1]).toBe(outputPath);
    });

    it('handler mkdir is required — without it gws write would fail', async () => {
      const outputPath = path.join(tmpWorkspace, 'deep', 'nested', 'Doc.txt');

      const { resolveWorkspacePath } = require('../../executor/workspace.js');
      (resolveWorkspacePath as jest.Mock).mockReturnValue(outputPath);

      // Verify the parent directory does NOT exist before handler runs
      const parentBefore = await fs.stat(path.dirname(outputPath)).catch(() => null);
      expect(parentBefore).toBeNull();

      mockExecute
        .mockResolvedValueOnce({ success: true, data: { name: 'Doc' }, stderr: '' })
        .mockImplementationOnce(async () => {
          // Parent directory must exist at this point (handler created it)
          const stat = await fs.stat(path.dirname(outputPath));
          expect(stat.isDirectory()).toBe(true);
          await fs.writeFile(outputPath, 'content');
          return { success: true, data: {}, stderr: '' };
        });

      const handler = drivePatch.customHandlers!.export!;
      await handler(
        { fileId: 'abc123', mimeType: 'text/plain' },
        'user@test.com',
      );
    });

    it('works with flat filename (no subdirectory)', async () => {
      const outputPath = path.join(tmpWorkspace, 'Doc.pdf');

      const { resolveWorkspacePath } = require('../../executor/workspace.js');
      (resolveWorkspacePath as jest.Mock).mockReturnValue(outputPath);

      mockExecute
        .mockResolvedValueOnce({ success: true, data: { name: 'Doc' }, stderr: '' })
        .mockImplementationOnce(async () => {
          await fs.writeFile(outputPath, 'pdf content');
          return { success: true, data: {}, stderr: '' };
        });

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
      const outputPath = path.join(tmpWorkspace, 'images', 'photo.png');

      const { resolveWorkspacePath } = require('../../executor/workspace.js');
      (resolveWorkspacePath as jest.Mock).mockReturnValue(outputPath);

      // Verify parent does NOT exist before handler runs
      const parentBefore = await fs.stat(path.dirname(outputPath)).catch(() => null);
      expect(parentBefore).toBeNull();

      mockExecute
        .mockResolvedValueOnce({ success: true, data: { name: 'photo.png', mimeType: 'image/png' }, stderr: '' })
        .mockImplementationOnce(async () => {
          // Parent directory must exist at this point
          const stat = await fs.stat(path.dirname(outputPath));
          expect(stat.isDirectory()).toBe(true);
          await fs.writeFile(outputPath, 'png data');
          return { success: true, data: {}, stderr: '' };
        });

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
