/**
 * Scratchpad attachments stay inside the workspace.
 *
 * A `drive` attachment used to store the caller's fileId as its file-system location,
 * and `send` to `workspace` then ran `fs.copyFile(location, join(targetDir, filename))`
 * with neither end checked. A fileId such as "/../../../../.bashrc" read a file from
 * outside the workspace and wrote one outside it. A Drive attachment is now downloaded
 * into the workspace at attach time, so the file ID only ever reaches the Drive API,
 * and the copy on send holds both ends to the workspace.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../google/client.js');
import { mockCall, mockDownload } from '../handlers/__mocks__/client.js';

const { handleScratchpad, getScratchpadManager } = await import('../../../server/scratchpad/handler.js');

const ACCOUNT = 'someone@example.com';
const root = path.join(os.tmpdir(), `gws-attach-${process.pid}-${Date.now()}`);
const workspace = path.join(root, 'workspace');
const outside = path.join(root, 'outside');
const originalWorkspaceDir = process.env.WORKSPACE_DIR;

/** Drive answers files.get metadata with `meta`, and writes `bytes` on download. */
function driveServes(meta: { name: string; mimeType: string }, bytes = 'drive bytes'): void {
  mockCall.mockResolvedValue(meta as never);
  mockDownload.mockImplementation(async (_svc, _method, _params, out) => {
    await fs.writeFile(out, bytes);
    return out;
  });
}

async function listWorkspace(): Promise<string[]> {
  return (await fs.readdir(workspace, { recursive: true })).sort();
}

beforeEach(async () => {
  process.env.WORKSPACE_DIR = workspace;
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
});

afterEach(() => {
  mockCall.mockReset();
  mockDownload.mockReset();
});

afterAll(async () => {
  if (originalWorkspaceDir === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = originalWorkspaceDir;
  await fs.rm(root, { recursive: true, force: true });
});

describe('attach with source drive', () => {
  it('downloads the file into the workspace and records that path as its location', async () => {
    driveServes({ name: 'report.pdf', mimeType: 'application/pdf' }, '%PDF');
    const id = getScratchpadManager().create({ content: 'body' });

    const result = await handleScratchpad({
      operation: 'attach', scratchpadId: id, source: 'drive', fileId: 'drive-file-1', email: ACCOUNT,
    });

    expect(result.refs.error).toBeUndefined();
    expect(mockDownload).toHaveBeenCalledWith(
      'drive', 'files.get',
      expect.objectContaining({ fileId: 'drive-file-1', alt: 'media' }),
      path.join(workspace, 'report.pdf'),
      expect.objectContaining({ account: ACCOUNT }),
    );
    const att = getScratchpadManager().getAttachments(id)!.get(result.refs.refId as string)!;
    expect(att).toMatchObject({
      source: 'drive',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 4,
      location: path.join(workspace, 'report.pdf'),
    });
  });

  it('sends a path-shaped fileId to the Drive API and never to the file system', async () => {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside the workspace');
    mockCall.mockRejectedValue(new Error('File not found: /../../outside/secret.txt'));
    const id = getScratchpadManager().create({ content: 'body' });

    const result = await handleScratchpad({
      operation: 'attach', scratchpadId: id, source: 'drive',
      fileId: '/../../outside/secret.txt', email: ACCOUNT,
    });

    expect(result.text).toContain('Cannot attach drive file: File not found');
    expect(mockCall).toHaveBeenCalledWith(
      'drive', 'files.get',
      expect.objectContaining({ fileId: '/../../outside/secret.txt' }),
      expect.objectContaining({ account: ACCOUNT }),
    );
    expect(getScratchpadManager().getAttachments(id)!.size).toBe(0);
    expect(await listWorkspace()).toEqual([]);
  });

  it('flattens a Drive name holding separators into one workspace segment', async () => {
    driveServes({ name: '../../escape.sh', mimeType: 'text/x-sh' });
    const id = getScratchpadManager().create({ content: 'body' });

    const result = await handleScratchpad({
      operation: 'attach', scratchpadId: id, source: 'drive', fileId: 'f1', email: ACCOUNT,
    });

    const att = getScratchpadManager().getAttachments(id)!.get(result.refs.refId as string)!;
    expect(path.dirname(att.location)).toBe(workspace);
    expect(await listWorkspace()).toEqual([att.filename]);
  });

  it('refuses a Google-native file before fetching any bytes', async () => {
    mockCall.mockResolvedValue({ name: 'Plan', mimeType: 'application/vnd.google-apps.document' } as never);
    const id = getScratchpadManager().create({ content: 'body' });

    const result = await handleScratchpad({
      operation: 'attach', scratchpadId: id, source: 'drive', fileId: 'doc-1', email: ACCOUNT,
    });

    expect(result.text).toContain('Google-native file');
    expect(result.text).toContain('manage_drive export');
    expect(mockDownload).not.toHaveBeenCalled();
    expect(getScratchpadManager().getAttachments(id)!.size).toBe(0);
  });

  it('requires the account that can read the file', async () => {
    const id = getScratchpadManager().create({ content: 'body' });

    const result = await handleScratchpad({
      operation: 'attach', scratchpadId: id, source: 'drive', fileId: 'f1',
    });

    expect(result.text).toContain('fileId and email are required');
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe('send to workspace', () => {
  it('copies a drive attachment alongside the content file', async () => {
    driveServes({ name: 'chart.png', mimeType: 'image/png' }, 'png');
    const id = getScratchpadManager().create({ content: 'body' });
    await handleScratchpad({ operation: 'attach', scratchpadId: id, source: 'drive', fileId: 'f1', email: ACCOUNT });

    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target: 'workspace', targetParams: { filename: 'out/note.md' },
    });

    expect(result.refs.attachmentsCopied).toBe(1);
    expect(await fs.readFile(path.join(workspace, 'out', 'chart.png'), 'utf-8')).toBe('png');
  });

  // The side-table can only hold workspace paths now; these cases plant a bad entry
  // directly to prove the copy holds its own line if one ever gets in.
  it('refuses to copy from a source outside the workspace, and says so', async () => {
    await fs.writeFile(path.join(outside, 'secret.txt'), 'outside the workspace');
    const id = getScratchpadManager().create({ content: 'body' });
    getScratchpadManager().attach(id, {
      source: 'drive', filename: 'secret.txt', mimeType: 'text/plain', size: 21,
      location: path.join(outside, 'secret.txt'),
    });

    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target: 'workspace', targetParams: { filename: 'note.md' },
    });

    expect(result.refs.attachmentsCopied).toBe(0);
    expect(result.refs.attachmentsFailed).toEqual([expect.stringContaining('att-1 (secret.txt)')]);
    expect(result.text).toContain('1 attachment(s) not copied');
    expect(await listWorkspace()).toEqual(['note.md']);
  });

  it('keeps a traversal filename from writing outside the workspace', async () => {
    await fs.writeFile(path.join(workspace, 'inside.txt'), 'inside');
    const id = getScratchpadManager().create({ content: 'body' });
    getScratchpadManager().attach(id, {
      source: 'drive', filename: '../outside/planted.txt', mimeType: 'text/plain', size: 6,
      location: path.join(workspace, 'inside.txt'),
    });

    const result = await handleScratchpad({
      operation: 'send', scratchpadId: id, target: 'workspace', targetParams: { filename: 'note.md' },
    });

    expect(result.refs.attachmentsCopied).toBe(1);
    expect(await fs.readdir(outside)).toEqual([]);
    expect(await listWorkspace()).toEqual(['inside.txt', 'note.md', 'planted.txt']);
  });
});
