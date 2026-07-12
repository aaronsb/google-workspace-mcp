import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction, type Mock } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadManifest, generateTools, generateSchema, generateHandler } from '../../factory/generator.js';
import { patches } from '../../factory/patches.js';
import type { Manifest, ServiceDef } from '../../factory/types.js';

// ONE seam (ADR-103). Every operation the generator can reach — resource ops via
// the manifest, custom handlers via the patches — goes through the Google API
// client we own, which returns RAW Google JSON (no { success, data, stderr }
// envelope). The gws executor is deliberately NOT mocked: nothing on these paths
// shells out any more, so a test that mocked it would be asserting against a
// seam that no longer carries traffic.
vi.mock('../../google/client.js');
import { call, upload } from '../../google/client.js';
const mockCall = call as MockedFunction<typeof call>;
const mockUpload = upload as MockedFunction<typeof upload>;

/** The RFC 5322 message handed to Gmail by the last upload() — what actually gets sent. */
function uploadedMime(callIndex = 0): string {
  return (mockUpload.mock.calls[callIndex][3].media as Buffer).toString('utf-8');
}

/** Decode the base64 body of a single-part (no attachments) RFC 5322 message. */
function singlePartBody(mime: string): string {
  const [, ...rest] = mime.split(/\r?\n\r?\n/);
  return Buffer.from(rest.join('').replace(/\r?\n/g, ''), 'base64').toString('utf-8');
}

describe('loadManifest', () => {
  it('loads and parses the manifest YAML', () => {
    const manifest = loadManifest();
    expect(manifest.services).toBeDefined();
    expect(manifest.services.gmail).toBeDefined();
    expect(manifest.services.calendar).toBeDefined();
    expect(manifest.services.drive).toBeDefined();
  });

  it('has correct tool names', () => {
    const manifest = loadManifest();
    expect(manifest.services.gmail.tool_name).toBe('manage_email');
    expect(manifest.services.calendar.tool_name).toBe('manage_calendar');
    expect(manifest.services.drive.tool_name).toBe('manage_drive');
  });
});

describe('generateSchema', () => {
  const manifest = loadManifest();

  it('generates operation enum from manifest operations', () => {
    const schema = generateSchema(manifest.services.gmail);
    const props = schema.inputSchema.properties as Record<string, any>;
    // Core operations present (manifest may expand)
    expect(props.operation.enum).toContain('search');
    expect(props.operation.enum).toContain('read');
    expect(props.operation.enum).toContain('send');
    expect(props.operation.enum).toContain('reply');
    expect(props.operation.enum).toContain('triage');
    expect(props.operation.enum).toContain('forward');
    expect(props.operation.enum).toContain('trash');
    expect(props.operation.enum).toContain('labels');
  });

  it('includes email param when requires_email is true', () => {
    const schema = generateSchema(manifest.services.gmail);
    const required = schema.inputSchema.required as string[];
    expect(required).toContain('email');
  });

  it('collects params from all operations', () => {
    const schema = generateSchema(manifest.services.gmail);
    const props = schema.inputSchema.properties as Record<string, any>;
    // From search
    expect(props.query).toBeDefined();
    expect(props.maxResults).toBeDefined();
    // From read
    expect(props.messageId).toBeDefined();
    // From send
    expect(props.to).toBeDefined();
    expect(props.subject).toBeDefined();
    expect(props.body).toBeDefined();
  });

  it('sets additionalProperties: false', () => {
    const schema = generateSchema(manifest.services.gmail);
    expect(schema.inputSchema.additionalProperties).toBe(false);
  });

  it('uses tool_name from service def', () => {
    const schema = generateSchema(manifest.services.drive);
    expect(schema.name).toBe('manage_drive');
  });
});

describe('generateTools', () => {
  it('produces one tool per manifest service', () => {
    const manifest = loadManifest();
    const tools = generateTools(manifest, patches);
    expect(tools.length).toBeGreaterThanOrEqual(6);
    const names = tools.map(t => t.schema.name);
    expect(names).toContain('manage_email');
    expect(names).toContain('manage_calendar');
    expect(names).toContain('manage_drive');
    expect(names).toContain('manage_sheets');
    expect(names).toContain('manage_tasks');
    expect(names).toContain('manage_meet');
    // manage_contacts excluded pending gws auth scope support
  });

  it('each tool has both schema and handler', () => {
    const manifest = loadManifest();
    const tools = generateTools(manifest, patches);
    for (const tool of tools) {
      expect(tool.schema).toHaveProperty('name');
      expect(tool.schema).toHaveProperty('inputSchema');
      expect(typeof tool.handler).toBe('function');
    }
  });
});

describe('generateHandler', () => {
  const manifest = loadManifest();

  beforeEach(() => {
    mockCall.mockReset();
    mockUpload.mockReset();
  });

  it('calls the Google client with (service, resourcePath, params) for resource operations', async () => {
    mockCall.mockResolvedValue({ files: [] });
    const handler = generateHandler(manifest.services.drive, patches.drive);

    await handler({ operation: 'search', email: 'u@t.com', query: 'budget' });

    expect(mockCall).toHaveBeenCalledWith(
      'drive',
      'files.list',
      expect.objectContaining({ q: 'budget' }),
      expect.objectContaining({ account: 'u@t.com' }),
    );
  });

  it('throws when an operation declares no resource and has no custom handler', async () => {
    // REPLACES "calls execute with correct args for helper-based operations".
    // That test had a FALSE PREMISE: there are no helper-based operations. Every
    // gws `+helper` is gone — the nine that were plain Google methods in a CLI
    // costume are manifest resource ops, and the two that genuinely reshaped
    // anything (+triage, +agenda) are custom handlers / afterExecute hooks over
    // raw Google. Nothing is left for the generator's else-branch to call, so the
    // behaviour worth pinning is that such an op FAILS LOUDLY rather than
    // silently doing nothing.
    const orphan: ServiceDef = {
      tool_name: 'manage_orphan',
      description: 'a service with an unroutable operation',
      requires_email: true,
      gws_service: 'gmail',
      operations: {
        stranded: { type: 'action', description: 'declares no resource' },
      },
    };

    const handler = generateHandler(orphan, undefined);

    await expect(
      handler({ operation: 'stranded', email: 'u@t.com' }),
    ).rejects.toThrow("gmail.stranded declares no 'resource' and has no custom handler.");
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('uses patch formatList when available', async () => {
    // triage is now a resource op (users.messages.list with an unread query) whose
    // afterExecute hydrates the bare IDs Google returns. The formatter therefore
    // reads REAL Gmail shapes, not gws's invented flat {id,from,subject,date}.
    mockCall.mockResolvedValueOnce({ messages: [{ id: 'msg-1' }] });
    mockCall.mockResolvedValueOnce({
      id: 'msg-1', threadId: 't1', snippet: 'hi',
      payload: { headers: [
        { name: 'From', value: 'alice@t.com' },
        { name: 'Subject', value: 'hi' },
        { name: 'Date', value: '2024-01-01' },
      ]},
    });
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    const result = await handler({ operation: 'triage', email: 'u@t.com' });

    expect(mockCall).toHaveBeenCalledWith(
      'gmail',
      'users.messages.list',
      expect.objectContaining({ userId: 'me', q: 'is:unread in:inbox' }),
      expect.objectContaining({ account: 'u@t.com' }),
    );
    // Gmail patch uses formatEmailList which produces pipe-delimited format
    expect(result.text).toContain('msg-1');
    expect(result.text).toContain('alice@t.com');
    expect(result.text).toContain('|');
  });

  it('delegates to customHandler when defined', async () => {
    // Gmail send is a custom handler: it builds an RFC 5322 message and uploads it
    // to users.messages.send. Nothing shells out.
    mockUpload.mockResolvedValue({ id: 'sent-1', threadId: 'thread-1' });
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    const result = await handler({
      operation: 'send',
      email: 'u@t.com',
      to: 'bob@t.com',
      subject: 'hello',
      body: 'hi bob',
    });

    expect(mockUpload).toHaveBeenCalledWith(
      'gmail',
      'users.messages.send',
      { userId: 'me' },
      expect.objectContaining({ account: 'u@t.com', contentType: 'message/rfc822' }),
    );
    expect(uploadedMime()).toContain('To: bob@t.com');
    expect(uploadedMime()).toContain('Subject: hello');
    expect(result.text).toContain('Email sent to bob@t.com');
    expect(result.refs).toHaveProperty('to', 'bob@t.com');
  });

  it('passes from alias to Gmail send customHandler', async () => {
    // Was an argv assertion (`--from`, then the value in the next slot). The `from`
    // alias only ever meant one thing: the From header of the message Gmail sends.
    // So assert it lands there.
    mockUpload.mockResolvedValue({ id: 'sent-1', threadId: 'thread-1' });
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    await handler({
      operation: 'send',
      email: 'u@t.com',
      to: 'bob@t.com',
      subject: 'hello',
      body: 'hi bob',
      from: 'Agent Name <agent@example.com>',
    });

    expect(uploadedMime()).toContain('From: Agent Name <agent@example.com>');
  });

  it('throws on unknown operation', async () => {
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    await expect(
      handler({ operation: 'nonexistent', email: 'u@t.com' }),
    ).rejects.toThrow('Unknown gmail operation: nonexistent');
  });

  describe('reply and replyAll honour attachments, html and draft (#132)', () => {
    // These tests used to read gws argv (`+reply`, `--draft`, `--attach`, `--html`,
    // `--cc`, and a `cwd` because --attach paths were cwd-relative). reply/replyAll
    // now build an RFC 5322 message themselves (src/services/gmail/mail.ts) and
    // upload it, so the assertions look at the two things that decide what the user
    // gets: WHICH endpoint (users.drafts.create vs users.messages.send) and WHAT
    // message (the MIME bytes).
    let workspace: string;
    let originalWorkspaceDir: string | undefined;

    beforeAll(async () => {
      workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'gws-reply-test-'));
      await fs.writeFile(path.join(workspace, 'report.pdf'), 'pdf');
      await fs.writeFile(path.join(workspace, 'data.csv'), 'a,b');
      originalWorkspaceDir = process.env.WORKSPACE_DIR;
      process.env.WORKSPACE_DIR = workspace;
    });

    afterAll(async () => {
      if (originalWorkspaceDir === undefined) delete process.env.WORKSPACE_DIR;
      else process.env.WORKSPACE_DIR = originalWorkspaceDir;
      await fs.rm(workspace, { recursive: true, force: true });
    });

    /** The message being replied to — reply/replyAll fetch it to build headers and quote it. */
    const originalMessage = {
      id: 'msg-1',
      threadId: 'thread-1',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'Message-ID', value: '<orig@mail.test>' },
          { name: 'Subject', value: 'Budget' },
          { name: 'From', value: 'alice@t.com' },
          { name: 'To', value: 'u@t.com, bob@t.com' },
          { name: 'Cc', value: 'dave@t.com' },
          { name: 'Date', value: 'Mon, 10 Mar 2026 10:00:00 -0500' },
        ],
        body: { data: Buffer.from('original body', 'utf-8').toString('base64url') },
      },
    };

    /** users.messages.get -> the original; everything else is an upload. */
    const mockOriginal = () => mockCall.mockResolvedValue(originalMessage);

    it.each([
      ['reply'],
      ['replyAll'],
    ])('%s attaches workspace files and forces draft', async (operation) => {
      mockOriginal();
      mockUpload.mockResolvedValue({ id: 'draft-1' });
      const handler = generateHandler(manifest.services.gmail, patches.gmail);

      const result = await handler({
        operation,
        email: 'u@t.com',
        messageId: 'msg-1',
        body: 'see attached',
        attachments: 'report.pdf, data.csv',
      });

      // Attachments still imply a draft — now a deliberate safety choice, not a
      // gws limitation (the client can send attachments outright).
      expect(mockUpload).toHaveBeenCalledWith(
        'gmail',
        'users.drafts.create',
        { userId: 'me' },
        expect.objectContaining({
          account: 'u@t.com',
          contentType: 'message/rfc822',
          // A draft reply must stay in the original thread.
          metadata: { message: { threadId: 'thread-1' } },
        }),
      );

      // The files are read from the WORKSPACE — this is what the old `cwd` assertion
      // was really protecting — and carried as real MIME parts.
      const mime = uploadedMime();
      expect(mime).toContain('Content-Disposition: attachment; filename="report.pdf"');
      expect(mime).toContain('Content-Disposition: attachment; filename="data.csv"');
      expect(mime).toContain(Buffer.from('pdf').toString('base64'));
      expect(mime).toContain(Buffer.from('a,b').toString('base64'));

      expect(result.refs).toMatchObject({ isDraft: true, draftId: 'draft-1' });
    });

    it.each([
      ['reply'],
      ['replyAll'],
    ])('%s passes html flag through', async (operation) => {
      mockOriginal();
      mockUpload.mockResolvedValue({ id: 'sent-1', threadId: 'thread-1' });
      const handler = generateHandler(manifest.services.gmail, patches.gmail);

      await handler({
        operation,
        email: 'u@t.com',
        messageId: 'msg-1',
        body: '<b>hi</b>',
        html: true,
      });

      const mime = uploadedMime();
      expect(mime).toContain('Content-Type: text/html');
      expect(mime).not.toContain('Content-Type: text/plain');
      // ...and the part really carries our HTML, not an escaped/stripped version.
      expect(singlePartBody(mime)).toContain('<b>hi</b>');
    });

    it.each([
      ['reply'],
      ['replyAll'],
    ])('%s sends live when no attachments and no draft flag', async (operation) => {
      mockOriginal();
      mockUpload.mockResolvedValue({ id: 'sent-1', threadId: 'thread-1' });
      const handler = generateHandler(manifest.services.gmail, patches.gmail);

      const result = await handler({
        operation,
        email: 'u@t.com',
        messageId: 'msg-1',
        body: 'plain reply',
      });

      expect(mockUpload).toHaveBeenCalledWith(
        'gmail',
        'users.messages.send',
        { userId: 'me' },
        expect.objectContaining({ metadata: { threadId: 'thread-1' } }),
      );
      expect(result.refs).not.toHaveProperty('isDraft');
    });

    it.each([
      ['reply'],
      ['replyAll'],
    ])('%s honours an explicit draft flag with no attachments', async (operation) => {
      mockOriginal();
      mockUpload.mockResolvedValue({ id: 'draft-1' });
      const handler = generateHandler(manifest.services.gmail, patches.gmail);

      const result = await handler({
        operation,
        email: 'u@t.com',
        messageId: 'msg-1',
        body: 'hold this',
        draft: true,
      });

      expect(mockUpload.mock.calls[0][1]).toBe('users.drafts.create');
      expect(uploadedMime()).not.toContain('Content-Disposition: attachment');
      expect(result.refs).toMatchObject({ isDraft: true });
    });

    it.each([
      ['reply'],
      ['replyAll'],
    ])('%s threads the reply to the original message', async (operation) => {
      // Threading used to be gws's business. It is ours now, so it gets asserted:
      // In-Reply-To + References are what make a reply land in the conversation
      // rather than start a new one.
      mockOriginal();
      mockUpload.mockResolvedValue({ id: 'sent-1', threadId: 'thread-1' });
      const handler = generateHandler(manifest.services.gmail, patches.gmail);

      await handler({ operation, email: 'u@t.com', messageId: 'msg-1', body: 'ok' });

      const mime = uploadedMime();
      expect(mime).toContain('In-Reply-To: <orig@mail.test>');
      expect(mime).toContain('References: <orig@mail.test>');
      expect(mime).toContain('Subject: Re: Budget');
    });

    it('replyAll still passes cc alongside attachments', async () => {
      mockOriginal();
      mockUpload.mockResolvedValue({ id: 'draft-1' });
      const handler = generateHandler(manifest.services.gmail, patches.gmail);

      await handler({
        operation: 'replyAll',
        email: 'u@t.com',
        messageId: 'msg-1',
        body: 'see attached',
        cc: 'carol@t.com',
        attachments: 'report.pdf',
      });

      const mime = uploadedMime();
      const cc = mime.split(/\r?\n/).find(l => l.startsWith('Cc: '))!;
      // The caller's cc, plus the thread's other participants that reply-all pulls
      // in — and NOT the account's own address.
      expect(cc).toContain('carol@t.com');
      expect(cc).toContain('bob@t.com');
      expect(cc).toContain('dave@t.com');
      expect(cc).not.toContain('u@t.com');
      expect(mime).toContain('Content-Disposition: attachment; filename="report.pdf"');
    });

    it.each([
      ['reply'],
      ['replyAll'],
    ])('%s rejects an attachment outside the workspace', async (operation) => {
      mockOriginal();
      mockUpload.mockResolvedValue({ id: 'draft-1' });
      const handler = generateHandler(manifest.services.gmail, patches.gmail);

      await expect(
        handler({
          operation,
          email: 'u@t.com',
          messageId: 'msg-1',
          body: 'sneaky',
          attachments: '../../../etc/passwd',
        }),
      ).rejects.toThrow();
      // Nothing was sent — the fence is ours now (gws's cwd fence is gone).
      expect(mockUpload).not.toHaveBeenCalled();
    });
  });

  it('applies afterExecute hook for gmail search hydration', async () => {
    // First call: messages.list returns IDs
    mockCall.mockResolvedValueOnce({ messages: [{ id: 'msg-1' }, { id: 'msg-2' }] });
    // Hydration calls for each message
    mockCall.mockResolvedValueOnce({
      id: 'msg-1', threadId: 't1', snippet: 'hello',
      payload: { headers: [
        { name: 'From', value: 'alice@t.com' },
        { name: 'Subject', value: 'Meeting' },
        { name: 'Date', value: '2024-01-15' },
      ]},
    });
    mockCall.mockResolvedValueOnce({
      id: 'msg-2', threadId: 't2', snippet: 'world',
      payload: { headers: [
        { name: 'From', value: 'bob@t.com' },
        { name: 'Subject', value: 'Update' },
        { name: 'Date', value: '2024-01-16' },
      ]},
    });

    const handler = generateHandler(manifest.services.gmail, patches.gmail);
    const result = await handler({ operation: 'search', email: 'u@t.com', query: 'test' });

    // Should have hydrated the messages
    expect(result.text).toContain('alice@t.com');
    expect(result.text).toContain('Meeting');
    expect(result.refs).toHaveProperty('count', 2);
  });
});

// ADR-303: the generator appends next-steps for custom handlers, so patches
// no longer need to call nextSteps() inline. This is the architectural
// guarantee that replaces the per-handler regression tests.
describe('generateHandler — custom-handler next-steps wrapping', () => {
  const manifest = loadManifest();

  beforeEach(() => {
    mockCall.mockReset();
    mockUpload.mockReset();
  });

  it('appends next-steps to a custom handler response', async () => {
    // sheets.addSheet is a customHandler — its handler return has no footer,
    // but the factory should wrap with one from the next-steps registry.
    mockCall.mockResolvedValueOnce({
      replies: [{ addSheet: { properties: { sheetId: 42, title: 'T', gridProperties: {} } } }],
    });

    const handler = generateHandler(manifest.services.sheets, patches.sheets);
    const result = await handler({
      operation: 'addSheet',
      email: 'u@t.com',
      spreadsheetId: 'sheet-123',
      title: 'T',
    });

    expect(result.text).toContain('Sheet added');
    expect(result.text).toContain('Next steps:');
  });

  it('resolves placeholder values from the input params on custom handlers', async () => {
    mockCall.mockResolvedValueOnce({ replies: [{}] });

    const handler = generateHandler(manifest.services.sheets, patches.sheets);
    const result = await handler({
      operation: 'renameSheet',
      email: 'u@t.com',
      spreadsheetId: 'sheet-xyz',
      sheetId: 0,
      title: 'Main',
    });

    // The sheets.renameSheet next-steps entry references <spreadsheetId> —
    // the generator's contextMap should have resolved it.
    expect(result.text).toContain('sheet-xyz');
    expect(result.text).not.toContain('<spreadsheetId>');
  });

  it('does not double-append next-steps (regression for ADR-303 migration)', async () => {
    mockCall.mockResolvedValueOnce({
      replies: [{ addSheet: { properties: { sheetId: 99, title: 'Q', gridProperties: {} } } }],
    });

    const handler = generateHandler(manifest.services.sheets, patches.sheets);
    const result = await handler({
      operation: 'addSheet',
      email: 'u@t.com',
      spreadsheetId: 'sheet-123',
      title: 'Q',
    });

    // Exactly one footer marker in the response
    const matches = result.text.match(/---\n\*\*Next steps:\*\*/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
