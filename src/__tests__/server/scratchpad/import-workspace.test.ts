/**
 * Email and doc imports save attachments and images into the workspace. They used to
 * ignore an invalid workspace (one that is HOME, say) and write anyway, and they wrote
 * without verifyPathSafety. They now refuse an invalid workspace before changing the
 * scratchpad, and check each file they write.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../../google/client.js');
import { mockCall, mockDownload } from '../handlers/__mocks__/client.js';

const { handleScratchpad, getScratchpadManager } = await import('../../../server/scratchpad/handler.js');

const ACCOUNT = 'someone@example.com';
const root = path.join(os.tmpdir(), `gws-import-ws-${process.pid}-${Date.now()}`);
const home = path.join(root, 'home');
const workspace = path.join(root, 'workspace');
const outside = path.join(root, 'outside');
const originalWorkspaceDir = process.env.WORKSPACE_DIR;
const originalHome = process.env.HOME;

/** Gmail serves a message with a text body and one attachment named `report.pdf`. */
function gmailServesMessageWithAttachment(): void {
  mockCall.mockImplementation(async (_svc, method) => {
    if (method === 'users.messages.get') {
      return {
        payload: {
          mimeType: 'multipart/mixed',
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from('hello body').toString('base64url') } },
            { mimeType: 'application/pdf', filename: 'report.pdf', body: { attachmentId: 'att-1', size: 4 } },
          ],
        },
      } as never;
    }
    if (method === 'users.messages.attachments.get') {
      return { data: Buffer.from('%PDF').toString('base64url') } as never;
    }
    throw new Error(`unexpected call ${method}`);
  });
}

/** Gmail serves a message with a text body and no attachments. */
function gmailServesMessageWithoutAttachment(): void {
  mockCall.mockResolvedValue({
    payload: { mimeType: 'text/plain', body: { data: Buffer.from('hello body').toString('base64url') } },
  } as never);
}

/** Drive exports a doc whose markdown holds `count` embedded PNGs. */
function driveExportsDocWithImage(count = 1): void {
  const png = Buffer.from('png bytes').toString('base64');
  const images = Array.from({ length: count }, (_, i) => `![pic${i + 1}](data:image/png;base64,${png})`).join('\n\n');
  mockDownload.mockImplementation(async (_svc, _method, _params, out) => {
    await fs.writeFile(out, `# Title\n\n${images}\n`);
    return out;
  });
}

const importEmail = (id: string, includeAttachments = true) => handleScratchpad({
  operation: 'import', scratchpadId: id, source: 'email',
  sourceParams: { email: ACCOUNT, messageId: 'msg-1', includeAttachments },
});

const importDoc = (id: string) => handleScratchpad({
  operation: 'import', scratchpadId: id, source: 'doc',
  sourceParams: { email: ACCOUNT, documentId: 'doc-1' },
});

const content = (id: string) => getScratchpadManager().get(id)!.lines.join('\n');
const shortId = (id: string) => id.replace('sp-', '');

beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  process.env.HOME = home;
  process.env.WORKSPACE_DIR = workspace;
});

afterEach(() => {
  mockCall.mockReset();
  mockDownload.mockReset();
});

afterAll(async () => {
  if (originalWorkspaceDir === undefined) delete process.env.WORKSPACE_DIR;
  else process.env.WORKSPACE_DIR = originalWorkspaceDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(root, { recursive: true, force: true });
});

describe('email import', () => {
  it('saves an attachment into a valid workspace', async () => {
    gmailServesMessageWithAttachment();
    const id = getScratchpadManager().create({ content: 'before' });

    const result = await importEmail(id);

    expect(result.refs.error).toBeUndefined();
    expect(result.refs.attachmentsImported).toBe(1);
    await expect(fs.readFile(path.join(workspace, `${shortId(id)}-report.pdf`), 'utf8')).resolves.toBe('%PDF');
    expect(content(id)).toContain('hello body');
  });

  it('keeps the body above the attachment marker', async () => {
    gmailServesMessageWithAttachment();
    const id = getScratchpadManager().create({ content: 'before' });

    await importEmail(id);

    const lines = getScratchpadManager().get(id)!.lines;
    const body = lines.indexOf('hello body');
    const marker = lines.findIndex(l => l.includes('att:'));
    expect(body).toBeGreaterThan(0);
    expect(marker).toBeGreaterThan(body);
  });

  it('refuses an invalid workspace, writes nothing and leaves the scratchpad unchanged', async () => {
    gmailServesMessageWithAttachment();
    process.env.WORKSPACE_DIR = home;
    const id = getScratchpadManager().create({ content: 'before' });

    const result = await importEmail(id);

    expect(result.refs.error).toBe(true);
    expect(result.text).toMatch(/Workspace directory invalid/);
    expect(await fs.readdir(home)).toEqual([]);
    expect(content(id)).toBe('before');
  });

  it('still imports the body without attachments when the workspace is invalid', async () => {
    gmailServesMessageWithAttachment();
    process.env.WORKSPACE_DIR = home;
    const id = getScratchpadManager().create({ content: 'before' });

    const result = await importEmail(id, false);

    expect(result.refs.error).toBeUndefined();
    expect(content(id)).toContain('hello body');
    expect(await fs.readdir(home)).toEqual([]);
  });

  it('imports an email without attachments when the workspace is invalid', async () => {
    gmailServesMessageWithoutAttachment();
    process.env.WORKSPACE_DIR = home;
    const id = getScratchpadManager().create({ content: 'before' });

    const result = await importEmail(id);

    expect(result.refs.error).toBeUndefined();
    expect(content(id)).toContain('hello body');
    expect(await fs.readdir(home)).toEqual([]);
  });

  it('does not write an attachment through a symlink that points outside', async () => {
    gmailServesMessageWithAttachment();
    const id = getScratchpadManager().create({ content: 'before' });
    await fs.writeFile(path.join(outside, 'landed.pdf'), 'original');
    await fs.symlink(path.join(outside, 'landed.pdf'), path.join(workspace, `${shortId(id)}-report.pdf`));

    const result = await importEmail(id);

    expect(result.refs.attachmentsImported).toBe(0);
    await expect(fs.readFile(path.join(outside, 'landed.pdf'), 'utf8')).resolves.toBe('original');
  });
});

describe('doc import', () => {
  it('saves an embedded image into a valid workspace', async () => {
    driveExportsDocWithImage();
    const id = getScratchpadManager().create({ content: 'before' });

    const result = await importDoc(id);

    expect(result.refs.error).toBeUndefined();
    expect(result.text).toMatch(/1 embedded image\(s\) extracted as attachments/);
    await expect(fs.readFile(path.join(workspace, `${shortId(id)}-image-1.png`), 'utf8')).resolves.toBe('png bytes');
    const att = getScratchpadManager().getAttachments(id)!;
    expect([...att.values()].map(a => a.filename)).toEqual([`${shortId(id)}-image-1.png`]);
    expect(content(id)).toContain(`](att:${[...att.keys()][0]} "${shortId(id)}-image-1.png`);
  });

  it('imports a doc without images when the workspace is invalid', async () => {
    mockDownload.mockImplementation(async (_svc, _method, _params, out) => {
      await fs.writeFile(out, '# Title\n\nplain text\n');
      return out;
    });
    process.env.WORKSPACE_DIR = home;
    const id = getScratchpadManager().create({ content: 'before' });

    const result = await importDoc(id);

    expect(result.refs.error).toBeUndefined();
    expect(content(id)).toContain('plain text');
    expect(await fs.readdir(home)).toEqual([]);
  });

  it('refuses an invalid workspace, writes nothing and leaves the scratchpad unchanged', async () => {
    driveExportsDocWithImage();
    process.env.WORKSPACE_DIR = home;
    const id = getScratchpadManager().create({ content: 'before' });

    const result = await importDoc(id);

    expect(result.refs.error).toBe(true);
    expect(result.text).toMatch(/Workspace directory invalid/);
    expect(await fs.readdir(home)).toEqual([]);
    expect(content(id)).toBe('before');
  });

  it('does not write an image through a symlink that points outside', async () => {
    driveExportsDocWithImage();
    const id = getScratchpadManager().create({ content: 'before' });
    await fs.writeFile(path.join(outside, 'landed.png'), 'original');
    await fs.symlink(path.join(outside, 'landed.png'), path.join(workspace, `${shortId(id)}-image-1.png`));

    const result = await importDoc(id);

    expect(result.refs.error).toBe(true);
    await expect(fs.readFile(path.join(outside, 'landed.png'), 'utf8')).resolves.toBe('original');
  });

  it('writes nothing and leaves the scratchpad unchanged when a later image is refused', async () => {
    driveExportsDocWithImage(2);
    const id = getScratchpadManager().create({ content: 'before' });
    await fs.writeFile(path.join(outside, 'landed.png'), 'original');
    await fs.symlink(path.join(outside, 'landed.png'), path.join(workspace, `${shortId(id)}-image-2.png`));

    const result = await importDoc(id);

    expect(result.refs.error).toBe(true);
    await expect(fs.stat(path.join(workspace, `${shortId(id)}-image-1.png`))).rejects.toThrow(/ENOENT/);
    expect(getScratchpadManager().getAttachments(id)?.size ?? 0).toBe(0);
    expect(content(id)).toBe('before');
  });
});
