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

  describe('share', () => {
    it('sends type + role + emailAddress as JSON body, not via --params', async () => {
      mockExecute.mockResolvedValueOnce({
        success: true,
        data: { id: 'perm-1', emailAddress: 'bob@test.com', role: 'reader', type: 'user' },
        stderr: '',
      });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', shareEmail: 'bob@test.com', role: 'reader' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      expect(args.slice(0, 3)).toEqual(['drive', 'permissions', 'create']);
      expect(args).toContain('--json');

      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      // type MUST be in the body — omitting it caused
      // "The permission type field is required." on every share call.
      expect(body.type).toBe('user');
      expect(body.role).toBe('reader');
      expect(body.emailAddress).toBe('bob@test.com');

      // --params should only carry query params, not the permission body.
      const queryParams = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(queryParams.fileId).toBe('file-1');
      expect(queryParams.type).toBeUndefined();
      expect(queryParams.role).toBeUndefined();
    });

    it("defaults type to 'user' when not provided", async () => {
      mockExecute.mockResolvedValueOnce({ success: true, data: { id: 'perm-1' }, stderr: '' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', shareEmail: 'bob@test.com' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      expect(body.type).toBe('user');
      expect(body.role).toBe('reader'); // default from manifest flows through
    });

    it('rejects user/group share without shareEmail', async () => {
      const handler = drivePatch.customHandlers!.share!;
      await expect(handler({ fileId: 'file-1' }, 'user@test.com')).rejects.toThrow('shareEmail');
      await expect(handler({ fileId: 'file-1', type: 'group' }, 'user@test.com')).rejects.toThrow('shareEmail');
    });

    it("uses domain field when type is 'domain'", async () => {
      mockExecute.mockResolvedValueOnce({ success: true, data: { id: 'perm-1' }, stderr: '' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', type: 'domain', domain: 'acme.com', role: 'writer' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      expect(body.type).toBe('domain');
      expect(body.domain).toBe('acme.com');
      expect(body.emailAddress).toBeUndefined();
    });

    it("requires domain when type is 'domain'", async () => {
      const handler = drivePatch.customHandlers!.share!;
      await expect(
        handler({ fileId: 'file-1', type: 'domain' }, 'user@test.com'),
      ).rejects.toThrow('domain');
    });

    it("accepts type 'anyone' with no target", async () => {
      mockExecute.mockResolvedValueOnce({ success: true, data: { id: 'perm-1' }, stderr: '' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', type: 'anyone', role: 'reader' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      const body = JSON.parse(args[args.indexOf('--json') + 1]);
      expect(body.type).toBe('anyone');
      expect(body.emailAddress).toBeUndefined();
      expect(body.domain).toBeUndefined();
    });

    it('suppresses email notifications by default for user/group shares', async () => {
      mockExecute.mockResolvedValueOnce({ success: true, data: { id: 'perm-1' }, stderr: '' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', shareEmail: 'bob@test.com' },
        'user@test.com',
      );

      const args = mockExecute.mock.calls[0][0];
      const queryParams = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(queryParams.sendNotificationEmail).toBe(false);
    });
  });

  describe('listPermissions', () => {
    it('hits permissions.list and requests the fields the API omits by default', async () => {
      mockExecute.mockResolvedValueOnce({
        success: true,
        data: {
          permissions: [
            { id: 'owner-perm', type: 'user', role: 'owner', emailAddress: 'me@test.com' },
            { id: 'reader-perm', type: 'user', role: 'reader', emailAddress: 'bob@test.com' },
          ],
        },
        stderr: '',
      });

      const handler = drivePatch.customHandlers!.listPermissions!;
      const result = await handler({ fileId: 'file-1' }, 'me@test.com');

      const args = mockExecute.mock.calls[0][0];
      expect(args.slice(0, 3)).toEqual(['drive', 'permissions', 'list']);
      const queryParams = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(queryParams.fileId).toBe('file-1');
      // Without an explicit fields mask the Drive API returns only id/type — not
      // role or emailAddress — which made the listing useless.
      expect(queryParams.fields).toContain('role');
      expect(queryParams.fields).toContain('emailAddress');

      expect(result.text).toContain('Permissions on file-1 (2)');
      expect(result.text).toContain('owner-perm | owner | user | me@test.com');
      expect(result.text).toContain('reader-perm | reader | user | bob@test.com');
      expect(result.refs.count).toBe(2);
      expect(result.refs.permissionId).toBe('owner-perm');
    });

    it('reports an empty permission list without claiming "No files found"', async () => {
      mockExecute.mockResolvedValueOnce({ success: true, data: { permissions: [] }, stderr: '' });

      const handler = drivePatch.customHandlers!.listPermissions!;
      const result = await handler({ fileId: 'file-2' }, 'me@test.com');

      expect(result.text).toContain('No sharing permissions on file file-2');
      expect(result.text).not.toContain('No files found');
      expect(result.refs.count).toBe(0);
    });

    it("labels anyone-with-link and pending-owner permissions", async () => {
      mockExecute.mockResolvedValueOnce({
        success: true,
        data: {
          permissions: [
            { id: 'anyone-perm', type: 'anyone', role: 'reader' },
            { id: 'pending-perm', type: 'user', role: 'writer', emailAddress: 'new@test.com', pendingOwner: true },
          ],
        },
        stderr: '',
      });

      const handler = drivePatch.customHandlers!.listPermissions!;
      const result = await handler({ fileId: 'file-3' }, 'me@test.com');

      expect(result.text).toContain('anyone-perm | reader | anyone | anyone with the link');
      expect(result.text).toContain('[pending owner]');
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
