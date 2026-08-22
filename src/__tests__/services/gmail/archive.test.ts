/**
 * Tests for the gmail `archive` custom handler — save a message's headers +
 * plain-text body to a markdown file in the workspace. A LOCAL archive: it reads
 * the message and writes a file, and never touches Gmail's INBOX label.
 *
 * The handler goes through the Google API client we own (`call`), so the client
 * is the seam to mock. The workspace is mocked to a temp dir.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Registered here, not in the shared helper: vi.mock hoists per-file.
vi.mock('../../../google/client.js');
import { mockCall } from '../../server/handlers/__mocks__/client.js';

// Mock the workspace module with a temp dir.
const tmpWorkspace = path.join(os.tmpdir(), `gws-test-gmail-archive-${Date.now()}`);
vi.mock('../../../executor/workspace.js', () => ({
  ensureWorkspaceDir: vi.fn(async () => ({ path: tmpWorkspace, valid: true })),
  getWorkspaceDir: vi.fn(() => tmpWorkspace),
  resolveWorkspacePath: vi.fn((filename: string) => path.join(tmpWorkspace, filename)),
  verifyPathSafety: vi.fn(async () => {}),
}));

import { gmailPatch } from '../../../services/gmail/patch.js';

// "Hello, body!" — base64url (same as base64 here; no + or / to transform).
const PLAIN_BODY_B64 = 'SGVsbG8sIGJvZHkh';

function messageFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Subject', value: 'Hello World!' },
        { name: 'Date', value: 'Tue, 19 Aug 2026 11:12:00 -0400' },
        { name: 'From', value: 'Alice <alice@example.com>' },
        { name: 'To', value: 'Bob <bob@example.com>' },
      ],
      body: { data: PLAIN_BODY_B64 },
    },
    ...overrides,
  };
}

describe('gmailPatch archive handler', () => {
  beforeEach(async () => {
    mockCall.mockReset();
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
    await fs.mkdir(tmpWorkspace, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  });

  it('fetches the full message and writes headers + body to a markdown file', async () => {
    mockCall.mockResolvedValueOnce(messageFixture());

    const handler = gmailPatch.customHandlers!.archive!;
    const result = await handler({ messageId: 'msg-1' }, 'user@test.com');

    expect(mockCall).toHaveBeenCalledWith(
      'gmail',
      'users.messages.get',
      expect.objectContaining({ userId: 'me', id: 'msg-1', format: 'full' }),
      expect.objectContaining({ account: 'user@test.com' }),
    );

    // Default filename: "<date>_<subject-slug>.md"
    expect(result.refs.filename).toBe('2026-08-19_hello-world.md');

    const written = await fs.readFile(String(result.refs.path), 'utf-8');
    expect(written).toContain('# Hello World!');
    expect(written).toContain('**Message ID:** `msg-1`');
    expect(written).toContain('**From:** Alice <alice@example.com>');
    expect(written).toContain('**To:** Bob <bob@example.com>');
    expect(written).toContain('Hello, body!');
    expect(result.refs.messageId).toBe('msg-1');
  });

  it('uses an explicit outputPath, creating parent directories', async () => {
    mockCall.mockResolvedValueOnce(messageFixture());

    const handler = gmailPatch.customHandlers!.archive!;
    const result = await handler({ messageId: 'msg-1', outputPath: 'subdir/note.md' }, 'user@test.com');

    const out = path.join(tmpWorkspace, 'subdir', 'note.md');
    expect(result.refs.path).toBe(out);
    const written = await fs.readFile(out, 'utf-8');
    expect(written).toContain('# Hello World!');
  });

  it('lists attachments in the file but does not download them', async () => {
    mockCall.mockResolvedValueOnce(messageFixture({
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'Subject', value: 'With attachment' },
          { name: 'Date', value: 'Tue, 19 Aug 2026 11:12:00 -0400' },
          { name: 'From', value: 'Alice <alice@example.com>' },
          { name: 'To', value: 'Bob <bob@example.com>' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: PLAIN_BODY_B64 } },
          { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'att-1', size: 1234 } },
        ],
      },
    }));

    const handler = gmailPatch.customHandlers!.archive!;
    const result = await handler({ messageId: 'msg-2' }, 'user@test.com');

    // Only users.messages.get was called — no attachments.get.
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall.mock.calls[0][1]).toBe('users.messages.get');

    const written = await fs.readFile(String(result.refs.path), 'utf-8');
    expect(written).toContain('**Attachments:** invoice.pdf (1234 bytes)');
    expect(result.refs.attachmentCount).toBe(1);
    expect(result.refs.attachments).toEqual(['invoice.pdf']);
  });

  it('falls back to the message id in the filename when the date is not parseable', async () => {
    mockCall.mockResolvedValueOnce(messageFixture({
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'Subject', value: 'No date' },
          { name: 'From', value: 'Alice <alice@example.com>' },
        ],
        body: { data: PLAIN_BODY_B64 },
      },
    }));

    const handler = gmailPatch.customHandlers!.archive!;
    const result = await handler({ messageId: 'abc-123' }, 'user@test.com');

    expect(result.refs.filename).toBe('abc-123_no-date.md');
  });

  it('requires a messageId', async () => {
    const handler = gmailPatch.customHandlers!.archive!;
    await expect(handler({}, 'user@test.com')).rejects.toThrow('messageId');
    expect(mockCall).not.toHaveBeenCalled();
  });
});
