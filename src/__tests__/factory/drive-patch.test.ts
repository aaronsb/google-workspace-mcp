/**
 * Tests for the drive service patch — custom handlers for download/export
 * that ensure parent directories are created before writing files, plus the
 * share / listPermissions / copy / update handlers whose whole reason to exist
 * is putting fields in the request BODY rather than the query.
 *
 * Every one of these is a RESOURCE op: they go through the Google API client we
 * own (`call` / `download`). `upload` is covered in
 * src/__tests__/server/handlers/drive.test.ts.
 */
import { afterAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Registered here, not in the shared helper: vi.mock hoists per-file.
vi.mock('../../google/client.js');
import { mockCall, mockDownload } from '../server/handlers/__mocks__/client.js';
import { requestFor, queryOf } from '../support/request.js';

// Mock workspace module with a temp dir
const tmpWorkspace = path.join(os.tmpdir(), `gws-test-${Date.now()}`);
vi.mock('../../executor/workspace.js', () => ({
  ensureWorkspaceDir: vi.fn(async () => ({ path: tmpWorkspace, valid: true })),
  getWorkspaceDir: vi.fn(() => tmpWorkspace),
  resolveWorkspacePath: vi.fn((filename: string) => path.join(tmpWorkspace, filename)),
  verifyPathSafety: vi.fn(async () => {}),
}));

// Mock file-output to avoid reading actual files
vi.mock('../../executor/file-output.js', () => ({
  isTextFile: vi.fn(() => true),
  isImageFile: vi.fn(() => false),
  formatFileOutput: vi.fn(() => '## Exported file\n'),
  buildImageBlock: vi.fn(() => null),
  buildImageBlockFromFile: vi.fn(() => null),
}));

import { drivePatch } from '../../services/drive/patch.js';

describe('drivePatch custom handlers', () => {
  beforeEach(async () => {
    mockCall.mockReset();
    mockDownload.mockReset();
    // Start with a clean workspace — only the root dir exists
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
    await fs.mkdir(tmpWorkspace, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  });

  describe('export', () => {
    it('streams to the resolved output path via files.export', async () => {
      const outputPath = path.join(tmpWorkspace, 'subdir', 'Report.txt');

      const { resolveWorkspacePath } = await import('../../executor/workspace.js');
      (resolveWorkspacePath as Mock).mockReturnValue(outputPath);

      // files.get for the source name…
      mockCall.mockResolvedValueOnce({ name: 'Report.gdoc' });
      // …then the export, which writes the bytes to disk.
      mockDownload.mockImplementationOnce(async (_svc, _rp, _params, out) => {
        await fs.writeFile(out, 'exported content');
        return out;
      });

      const handler = drivePatch.customHandlers!.export!;
      await handler(
        { fileId: 'abc123', mimeType: 'text/plain', outputPath: 'subdir/Report.txt' },
        'user@test.com',
      );

      expect(mockDownload).toHaveBeenCalledWith(
        'drive',
        'files.export',
        expect.objectContaining({ fileId: 'abc123', mimeType: 'text/plain' }),
        outputPath,
        expect.objectContaining({ account: 'user@test.com' }),
      );
    });

    it('handler mkdir is required — the parent dir exists by the time bytes land', async () => {
      const outputPath = path.join(tmpWorkspace, 'deep', 'nested', 'Doc.txt');

      const { resolveWorkspacePath } = await import('../../executor/workspace.js');
      (resolveWorkspacePath as Mock).mockReturnValue(outputPath);

      // Verify the parent directory does NOT exist before handler runs
      const parentBefore = await fs.stat(path.dirname(outputPath)).catch(() => null);
      expect(parentBefore).toBeNull();

      mockCall.mockResolvedValueOnce({ name: 'Doc' });
      mockDownload.mockImplementationOnce(async (_svc, _rp, _params, out) => {
        // Parent directory must exist at this point (the handler created it)
        const stat = await fs.stat(path.dirname(out));
        expect(stat.isDirectory()).toBe(true);
        await fs.writeFile(out, 'content');
        return out;
      });

      const handler = drivePatch.customHandlers!.export!;
      await handler(
        { fileId: 'abc123', mimeType: 'text/plain' },
        'user@test.com',
      );

      expect(mockDownload).toHaveBeenCalledTimes(1);
    });

    it('works with flat filename (no subdirectory)', async () => {
      const outputPath = path.join(tmpWorkspace, 'Doc.pdf');

      const { resolveWorkspacePath } = await import('../../executor/workspace.js');
      (resolveWorkspacePath as Mock).mockReturnValue(outputPath);

      mockCall.mockResolvedValueOnce({ name: 'Doc' });
      mockDownload.mockImplementationOnce(async (_svc, _rp, _params, out) => {
        await fs.writeFile(out, 'pdf content');
        return out;
      });

      const handler = drivePatch.customHandlers!.export!;
      const result = await handler(
        { fileId: 'abc123', mimeType: 'application/pdf' },
        'user@test.com',
      );

      expect(result.text).toBeDefined();
      expect(mockCall).toHaveBeenCalledTimes(1);      // files.get (name)
      expect(mockDownload).toHaveBeenCalledTimes(1);  // files.export
    });
  });

  describe('share', () => {
    it('sends type + role + emailAddress as the request body, not as query params', async () => {
      mockCall.mockResolvedValueOnce({
        id: 'perm-1', emailAddress: 'bob@test.com', role: 'reader', type: 'user',
      });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', shareEmail: 'bob@test.com', role: 'reader' },
        'user@test.com',
      );

      const [service, resourcePath, params, options] = mockCall.mock.calls[0];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('permissions.create');
      expect(options).toMatchObject({ account: 'user@test.com' });
      expect(params.fileId).toBe('file-1');

      // The descriptor decides placement, and it must put type/role/emailAddress
      // in the BODY — omitting type from the body caused
      // "The permission type field is required." on every share call.
      const request = await requestFor('drive', 'permissions.create', params);
      expect(request.body).toEqual({
        type: 'user',
        role: 'reader',
        emailAddress: 'bob@test.com',
      });
      // …and only query params in the query.
      const query = queryOf(request);
      expect(query.type).toBeUndefined();
      expect(query.role).toBeUndefined();
      expect(request.url).toContain('/files/file-1/permissions');
    });

    it("defaults type to 'user' when not provided", async () => {
      mockCall.mockResolvedValueOnce({ id: 'perm-1' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', shareEmail: 'bob@test.com' },
        'user@test.com',
      );

      const request = await requestFor('drive', 'permissions.create', mockCall.mock.calls[0][2]);
      expect(request.body).toMatchObject({ type: 'user', role: 'reader' });
    });

    it('rejects user/group share without shareEmail', async () => {
      const handler = drivePatch.customHandlers!.share!;
      await expect(handler({ fileId: 'file-1' }, 'user@test.com')).rejects.toThrow('shareEmail');
      await expect(handler({ fileId: 'file-1', type: 'group' }, 'user@test.com')).rejects.toThrow('shareEmail');
      expect(mockCall).not.toHaveBeenCalled();
    });

    it("uses domain field when type is 'domain'", async () => {
      mockCall.mockResolvedValueOnce({ id: 'perm-1' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', type: 'domain', domain: 'acme.com', role: 'writer' },
        'user@test.com',
      );

      const body = (await requestFor('drive', 'permissions.create', mockCall.mock.calls[0][2])).body!;
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
      mockCall.mockResolvedValueOnce({ id: 'perm-1' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', type: 'anyone', role: 'reader' },
        'user@test.com',
      );

      const body = (await requestFor('drive', 'permissions.create', mockCall.mock.calls[0][2])).body!;
      expect(body.type).toBe('anyone');
      expect(body.emailAddress).toBeUndefined();
      expect(body.domain).toBeUndefined();
    });

    it('suppresses email notifications by default for user/group shares', async () => {
      mockCall.mockResolvedValueOnce({ id: 'perm-1' });

      const handler = drivePatch.customHandlers!.share!;
      await handler(
        { fileId: 'file-1', shareEmail: 'bob@test.com' },
        'user@test.com',
      );

      expect(mockCall.mock.calls[0][2].sendNotificationEmail).toBe(false);
      // sendNotificationEmail is a QUERY param, per the descriptor.
      const query = queryOf(await requestFor('drive', 'permissions.create', mockCall.mock.calls[0][2]));
      expect(query.sendNotificationEmail).toBe('false');
    });
  });

  describe('listPermissions', () => {
    it('hits permissions.list and requests the fields the API omits by default', async () => {
      mockCall.mockResolvedValueOnce({
        permissions: [
          { id: 'owner-perm', type: 'user', role: 'owner', emailAddress: 'me@test.com' },
          { id: 'reader-perm', type: 'user', role: 'reader', emailAddress: 'bob@test.com' },
        ],
      });

      const handler = drivePatch.customHandlers!.listPermissions!;
      const result = await handler({ fileId: 'file-1' }, 'me@test.com');

      const [service, resourcePath, params] = mockCall.mock.calls[0];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('permissions.list');
      expect(params.fileId).toBe('file-1');
      // Without an explicit fields mask the Drive API returns only id/type — not
      // role or emailAddress — which made the listing useless. `fields` is a
      // GLOBAL query param: a GET has no body to hide it in.
      expect(String(params.fields)).toContain('role');
      expect(String(params.fields)).toContain('emailAddress');
      const request = await requestFor('drive', 'permissions.list', params);
      expect(request.method).toBe('GET');
      expect(queryOf(request).fields).toContain('role');

      expect(result.text).toContain('Permissions on file-1 (2)');
      expect(result.text).toContain('owner-perm | owner | user | me@test.com');
      expect(result.text).toContain('reader-perm | reader | user | bob@test.com');
      expect(result.refs.count).toBe(2);
      // A list has no canonical "the" permission — no singular permissionId ref.
      expect(result.refs.permissionId).toBeUndefined();
      expect(result.refs.permissions).toEqual([
        { permissionId: 'owner-perm', type: 'user', role: 'owner', target: 'me@test.com' },
        { permissionId: 'reader-perm', type: 'user', role: 'reader', target: 'bob@test.com' },
      ]);
    });

    it('reports an empty permission list without claiming "No files found"', async () => {
      mockCall.mockResolvedValueOnce({ permissions: [] });

      const handler = drivePatch.customHandlers!.listPermissions!;
      const result = await handler({ fileId: 'file-2' }, 'me@test.com');

      expect(result.text).toContain('No sharing permissions on file file-2');
      expect(result.text).not.toContain('No files found');
      expect(result.refs.count).toBe(0);
      expect(result.refs.permissions).toEqual([]);
    });

    it('labels anyone-with-link, pending-owner, deleted, and domain/displayName targets', async () => {
      mockCall.mockResolvedValueOnce({
        permissions: [
          { id: 'anyone-perm', type: 'anyone', role: 'reader' },
          { id: 'pending-perm', type: 'user', role: 'writer', emailAddress: 'new@test.com', pendingOwner: true },
          { id: 'domain-perm', type: 'domain', role: 'reader', domain: 'acme.com' },
          { id: 'group-perm', type: 'group', role: 'commenter', displayName: 'Eng Team' },
          { id: 'gone-perm', type: 'user', role: 'reader', emailAddress: 'old@test.com', deleted: true },
        ],
      });

      const handler = drivePatch.customHandlers!.listPermissions!;
      const result = await handler({ fileId: 'file-3' }, 'me@test.com');

      expect(result.text).toContain('anyone-perm | reader | anyone | anyone with the link');
      expect(result.text).toContain('[pending owner]');
      expect(result.text).toContain('domain-perm | reader | domain | acme.com');
      expect(result.text).toContain('group-perm | commenter | group | Eng Team');
      expect(result.text).toContain('gone-perm | reader | user | old@test.com [deleted account]');
    });
  });

  describe('copy', () => {
    it('sends name as the request body, not as a query param, so the copy is renamed', async () => {
      mockCall.mockResolvedValueOnce({
        id: 'copy-1', name: 'My New Name', mimeType: 'application/vnd.google-apps.spreadsheet',
      });

      const handler = drivePatch.customHandlers!.copy!;
      const result = await handler({ fileId: 'src-1', name: 'My New Name' }, 'user@test.com');

      const [service, resourcePath, params] = mockCall.mock.calls[0];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('files.copy');
      expect(params.fileId).toBe('src-1');

      const request = await requestFor('drive', 'files.copy', params);
      expect(request.body).toMatchObject({ name: 'My New Name' });
      // name must NOT leak into the query — that's the bug being fixed (copies
      // kept coming back named "Copy of X").
      expect(queryOf(request).name).toBeUndefined();
      expect(request.url).toContain('/files/src-1/copy');

      expect(result.text).toContain('File copied: **My New Name**');
      expect(result.text).toContain('**File ID:** copy-1');
      expect(result.refs.fileId).toBe('copy-1');
      expect(result.refs.sourceFileId).toBe('src-1');
    });

    it('forwards parentFolderId as body.parents', async () => {
      mockCall.mockResolvedValueOnce({ id: 'copy-2', name: 'Copy of X', parents: ['folder-9'] });

      const handler = drivePatch.customHandlers!.copy!;
      await handler({ fileId: 'src-2', parentFolderId: 'folder-9' }, 'user@test.com');

      const request = await requestFor('drive', 'files.copy', mockCall.mock.calls[0][2]);
      expect(request.body!.parents).toEqual(['folder-9']);
    });

    it('sends no name/parents in the body when neither is given', async () => {
      mockCall.mockResolvedValueOnce({ id: 'copy-3', name: 'Copy of X' });

      const handler = drivePatch.customHandlers!.copy!;
      await handler({ fileId: 'src-3' }, 'user@test.com');

      const params = mockCall.mock.calls[0][2];
      expect(params.name).toBeUndefined();
      expect(params.parents).toBeUndefined();
      // fields/supportsAllDrives are query params, so the POST carries no body.
      const request = await requestFor('drive', 'files.copy', params);
      expect(request.body).toBeUndefined();
    });
  });

  describe('update', () => {
    it('renames via the request body and surfaces the new name', async () => {
      mockCall.mockResolvedValueOnce({ id: 'file-1', name: 'Renamed.pdf', parents: ['root'] });

      const handler = drivePatch.customHandlers!.update!;
      const result = await handler({ fileId: 'file-1', name: 'Renamed.pdf' }, 'user@test.com');

      const [service, resourcePath, params] = mockCall.mock.calls[0];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('files.update');

      const request = await requestFor('drive', 'files.update', params);
      expect(request.method).toBe('PATCH');
      expect(request.body).toMatchObject({ name: 'Renamed.pdf' });
      expect(queryOf(request).name).toBeUndefined();

      expect(result.text).toContain('File updated: **Renamed.pdf**');
      expect(result.refs.name).toBe('Renamed.pdf');
    });

    it('moves between folders via addParents/removeParents query params (no body)', async () => {
      mockCall.mockResolvedValueOnce({ id: 'file-2', name: 'doc', parents: ['new-folder'] });

      const handler = drivePatch.customHandlers!.update!;
      await handler({ fileId: 'file-2', addParents: 'new-folder', removeParents: 'old-folder' }, 'user@test.com');

      const request = await requestFor('drive', 'files.update', mockCall.mock.calls[0][2]);
      expect(request.body).toBeUndefined(); // nothing to put in the body
      const query = queryOf(request);
      expect(query.addParents).toBe('new-folder');
      expect(query.removeParents).toBe('old-folder');
    });

    it('rename + move in one call populates both the body (name) and the query (parents)', async () => {
      mockCall.mockResolvedValueOnce({ id: 'file-4', name: 'Moved.pdf', parents: ['dest'] });

      const handler = drivePatch.customHandlers!.update!;
      const result = await handler(
        { fileId: 'file-4', name: 'Moved.pdf', addParents: 'dest', removeParents: 'src' },
        'user@test.com',
      );

      const request = await requestFor('drive', 'files.update', mockCall.mock.calls[0][2]);
      expect(request.body).toMatchObject({ name: 'Moved.pdf' });
      const query = queryOf(request);
      expect(query.addParents).toBe('dest');
      expect(query.removeParents).toBe('src');

      expect(result.text).toContain('File updated: **Moved.pdf**');
      expect(result.text).toContain('**Parents:** dest');
      expect(result.refs.parents).toEqual(['dest']);
    });

    it('omits refs.parents when the API response has none', async () => {
      mockCall.mockResolvedValueOnce({ id: 'file-5', name: 'R.pdf' });

      const handler = drivePatch.customHandlers!.update!;
      const result = await handler({ fileId: 'file-5', name: 'R.pdf' }, 'user@test.com');

      expect('parents' in result.refs).toBe(false);
    });

    it('rejects a no-op update (none of name/addParents/removeParents)', async () => {
      const handler = drivePatch.customHandlers!.update!;
      await expect(handler({ fileId: 'file-3' }, 'user@test.com')).rejects.toThrow(/name.*addParents.*removeParents/);
      expect(mockCall).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('creates parent directories before the bytes are streamed to disk', async () => {
      const outputPath = path.join(tmpWorkspace, 'images', 'photo.png');

      const { resolveWorkspacePath } = await import('../../executor/workspace.js');
      (resolveWorkspacePath as Mock).mockReturnValue(outputPath);

      // Verify parent does NOT exist before handler runs
      const parentBefore = await fs.stat(path.dirname(outputPath)).catch(() => null);
      expect(parentBefore).toBeNull();

      mockCall.mockResolvedValueOnce({ name: 'photo.png', mimeType: 'image/png' });
      mockDownload.mockImplementationOnce(async (_svc, _rp, _params, out) => {
        // Parent directory must exist at this point
        const stat = await fs.stat(path.dirname(out));
        expect(stat.isDirectory()).toBe(true);
        await fs.writeFile(out, 'png data');
        return out;
      });

      const handler = drivePatch.customHandlers!.download!;
      await handler(
        { fileId: 'img-1', outputPath: 'images/photo.png' },
        'user@test.com',
      );

      expect(mockDownload).toHaveBeenCalledWith(
        'drive',
        'files.get',
        expect.objectContaining({ fileId: 'img-1', alt: 'media' }),
        outputPath,
        expect.objectContaining({ account: 'user@test.com' }),
      );
    });
  });
});

describe('drivePatch folder, trash, and role handlers', () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  describe('createFolder', () => {
    it('posts a folder with the folder MIME type in the body', async () => {
      mockCall.mockResolvedValueOnce({ id: 'folder-1', name: 'Matter 12345', mimeType: 'application/vnd.google-apps.folder' });

      const handler = drivePatch.customHandlers!.createFolder!;
      const result = await handler({ name: 'Matter 12345' }, 'user@test.com');

      const [service, resourcePath, params] = mockCall.mock.calls[0];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('files.create');

      const request = await requestFor('drive', 'files.create', params);
      expect(request.method).toBe('POST');
      expect(request.body).toMatchObject({ name: 'Matter 12345', mimeType: 'application/vnd.google-apps.folder' });
      expect(request.body!.parents).toBeUndefined();

      expect(result.refs.folderId).toBe('folder-1');
      expect(result.refs.fileId).toBe('folder-1');
      expect(result.text).toContain('Folder created: **Matter 12345**');
    });

    it('nests under parentFolderId as body.parents = [id] (an array, not a string)', async () => {
      mockCall.mockResolvedValueOnce({ id: 'child-1', name: '01 - Evidence', parents: ['root-1'] });

      const handler = drivePatch.customHandlers!.createFolder!;
      await handler({ name: '01 - Evidence', parentFolderId: 'root-1' }, 'user@test.com');

      const request = await requestFor('drive', 'files.create', mockCall.mock.calls[0][2]);
      expect(request.body!.parents).toEqual(['root-1']);
      expect(request.body!.mimeType).toBe('application/vnd.google-apps.folder');
    });

    it('requires a name', async () => {
      const handler = drivePatch.customHandlers!.createFolder!;
      await expect(handler({}, 'user@test.com')).rejects.toThrow('name');
      expect(mockCall).not.toHaveBeenCalled();
    });
  });

  describe('listFolder', () => {
    it('lists non-trashed children with a parents query', async () => {
      mockCall.mockResolvedValueOnce({
        files: [
          { id: 'sub-1', name: '01 - Evidence', mimeType: 'application/vnd.google-apps.folder' },
          { id: 'f-1', name: 'index.pdf', mimeType: 'application/pdf' },
        ],
      });

      const handler = drivePatch.customHandlers!.listFolder!;
      const result = await handler({ folderId: 'root-1' }, 'user@test.com');

      const [service, resourcePath, params] = mockCall.mock.calls[0];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('files.list');
      expect(params.q).toContain("'root-1' in parents");
      expect(params.q).toContain('trashed=false');

      expect(result.text).toContain('[DIR] 01 - Evidence');
      expect(result.text).toContain('index.pdf');
      expect(result.refs.count).toBe(2);
      const files = result.refs.files as Array<{ isFolder: boolean }>;
      expect(files[0].isFolder).toBe(true);
      expect(files[1].isFolder).toBe(false);
    });

    it('reports an empty folder', async () => {
      mockCall.mockResolvedValueOnce({ files: [] });

      const handler = drivePatch.customHandlers!.listFolder!;
      const result = await handler({ folderId: 'root-2' }, 'user@test.com');

      expect(result.text).toContain('empty');
      expect(result.refs.count).toBe(0);
      expect(result.refs.files).toEqual([]);
    });
  });

  describe('listChildren paging and query safety', () => {
    it('follows nextPageToken so the reported count is the whole folder', async () => {
      // A single page looks authoritative. If the walk stopped at page one, the
      // "(n)" in the header would be a confident wrong number.
      mockCall
        .mockResolvedValueOnce({
          nextPageToken: 'page-2',
          files: [{ id: 'f-1', name: 'a.pdf', mimeType: 'application/pdf' }],
        })
        .mockResolvedValueOnce({
          files: [{ id: 'f-2', name: 'b.pdf', mimeType: 'application/pdf' }],
        });

      const handler = drivePatch.customHandlers!.listFolder!;
      const result = await handler({ folderId: 'root-1' }, 'user@test.com');

      expect(mockCall).toHaveBeenCalledTimes(2);
      expect(mockCall.mock.calls[1][2].pageToken).toBe('page-2');
      expect(result.text).toContain('(2)');
      expect(result.refs.count).toBe(2);
      expect(result.refs.truncated).toBe(false);
    });

    it("escapes a single quote in the folder id so it cannot close the q literal", async () => {
      mockCall.mockResolvedValueOnce({ files: [] });

      const handler = drivePatch.customHandlers!.listFolder!;
      await handler({ folderId: "ev'il" }, 'user@test.com');

      expect(mockCall.mock.calls[0][2].q).toBe("'ev\\'il' in parents and trashed=false");
    });
  });

  describe('tree', () => {
    it('walks folders recursively and counts files only', async () => {
      mockCall
        .mockResolvedValueOnce({
          files: [
            { id: 'sub-1', name: '01 - Evidence', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'f-0', name: 'index.pdf', mimeType: 'application/pdf' },
          ],
        })
        .mockResolvedValueOnce({
          files: [
            { id: 'f-1', name: 'exhibit.pdf', mimeType: 'application/pdf' },
            { id: 'f-2', name: 'scan.jpeg', mimeType: 'image/jpeg' },
          ],
        });

      const handler = drivePatch.customHandlers!.tree!;
      const result = await handler({ folderId: 'root-1' }, 'user@test.com');

      expect(mockCall).toHaveBeenCalledTimes(2);
      expect(mockCall.mock.calls[1][2].q).toContain("'sub-1' in parents");

      expect(result.text).toContain('[DIR] 01 - Evidence');
      expect(result.text).toContain('exhibit.pdf');
      expect(result.text).toContain('**TOTAL FILES:** 3');
      expect(result.refs.fileCount).toBe(3);
    });

    it('stops at maxDepth and labels the count partial rather than claiming it is total', async () => {
      mockCall.mockResolvedValue({
        files: [{ id: 'sub-deep', name: 'deeper', mimeType: 'application/vnd.google-apps.folder' }],
      });

      const handler = drivePatch.customHandlers!.tree!;
      const result = await handler({ folderId: 'root-1', maxDepth: 2 }, 'user@test.com');

      expect(mockCall).toHaveBeenCalledTimes(2);
      expect(result.text).toContain('partial');
      expect(result.refs.partial).toBe(true);
    });

    it('does not revisit a folder reachable by two parents', async () => {
      mockCall
        .mockResolvedValueOnce({
          files: [
            { id: 'shared', name: 'shared', mimeType: 'application/vnd.google-apps.folder' },
            { id: 'other', name: 'other', mimeType: 'application/vnd.google-apps.folder' },
          ],
        })
        .mockResolvedValueOnce({ files: [{ id: 'f-1', name: 'a.pdf', mimeType: 'application/pdf' }] })
        .mockResolvedValueOnce({
          files: [{ id: 'shared', name: 'shared', mimeType: 'application/vnd.google-apps.folder' }],
        });

      const handler = drivePatch.customHandlers!.tree!;
      const result = await handler({ folderId: 'root-1' }, 'user@test.com');

      // root, shared, other — 'shared' is listed twice but walked once.
      expect(mockCall).toHaveBeenCalledTimes(3);
      expect(result.refs.fileCount).toBe(1);
    });
  });

  describe('trash', () => {
    it('patches trashed:true in the body (recoverable, not permanent)', async () => {
      mockCall.mockResolvedValueOnce({ id: 'file-1', name: 'Doc.pdf', trashed: true });

      const handler = drivePatch.customHandlers!.trash!;
      const result = await handler({ fileId: 'file-1' }, 'user@test.com');

      const [service, resourcePath, params] = mockCall.mock.calls[0];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('files.update');

      const request = await requestFor('drive', 'files.update', params);
      expect(request.method).toBe('PATCH');
      expect(request.body).toMatchObject({ trashed: true });

      expect(result.text).toContain('Moved to trash');
      expect(result.refs.trashed).toBe(true);
    });
  });

  describe('setRole', () => {
    it('finds the permission by email then updates its role without notifying', async () => {
      mockCall
        .mockResolvedValueOnce({
          permissions: [{ id: 'perm-1', type: 'user', role: 'reader', emailAddress: 'bob@test.com' }],
        })
        .mockResolvedValueOnce({ id: 'perm-1', role: 'writer', emailAddress: 'bob@test.com' });

      const handler = drivePatch.customHandlers!.setRole!;
      const result = await handler(
        { fileId: 'file-1', shareEmail: 'bob@test.com', role: 'writer' },
        'user@test.com',
      );

      expect(mockCall.mock.calls[0][1]).toBe('permissions.list');
      expect(mockCall.mock.calls[0][2].fileId).toBe('file-1');

      const [service, resourcePath, params] = mockCall.mock.calls[1];
      expect(service).toBe('drive');
      expect(resourcePath).toBe('permissions.update');
      expect(params.permissionId).toBe('perm-1');
      const request = await requestFor('drive', 'permissions.update', params);
      expect(request.method).toBe('PATCH');
      expect(request.body).toMatchObject({ role: 'writer' });

      expect(result.text).toContain('No notification email was sent');
      expect(result.refs.notificationEmailSent).toBe(false);
      expect(result.refs.role).toBe('writer');
    });

    it('refuses to change a role when none is given, rather than defaulting', async () => {
      // Defaulting here would demote an existing writer to reader, and setRole
      // sends no notification — so the demotion would be silent. `share` may
      // default to least privilege on a GRANT; changing an existing role has no
      // safe default, so this throws before any API call is made.
      const handler = drivePatch.customHandlers!.setRole!;
      await expect(
        handler({ fileId: 'file-1', shareEmail: 'bob@test.com' }, 'user@test.com'),
      ).rejects.toThrow('role is required');

      expect(mockCall).not.toHaveBeenCalled();
    });

    it('errors when the email has no existing permission', async () => {
      mockCall.mockResolvedValueOnce({ permissions: [] });

      const handler = drivePatch.customHandlers!.setRole!;
      await expect(
        handler({ fileId: 'file-1', shareEmail: 'nobody@test.com', role: 'writer' }, 'user@test.com'),
      ).rejects.toThrow('no existing permission');

      expect(mockCall).toHaveBeenCalledTimes(1);
    });
  });

});
