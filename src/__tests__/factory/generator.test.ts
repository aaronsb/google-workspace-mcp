import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction, type Mock } from 'vitest';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadDescriptor } from '../../google/descriptor.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadManifest, generateTools, generateSchema, generateHandler } from '../../factory/generator.js';
import { patches } from '../../factory/patches.js';
import { SORT_ORDERS } from '../../services/contacts/patch.js';
import type { Manifest, ServiceDef } from '../../factory/types.js';

// ONE seam (ADR-103). Every operation the generator can reach — resource ops via
// the manifest, custom handlers via the patches — goes through the Google API
// client we own, which returns RAW Google JSON (no { success, data, stderr }
// envelope). Nothing on these paths shells out, so the client is the only seam a
// test needs to mock.
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

/**
 * Escape hatch for a collision that cannot be harmonized. Empty since #161, which makes
 * the test below a hard gate rather than a ratchet. Adding a line is a deliberate act;
 * see the file's own header before you do.
 */
const KNOWN_COLLISIONS = new Set(readFileSync(
  new URL('./known-param-collisions.txt', import.meta.url), 'utf-8',
).split('\n').map((l) => l.split('#')[0].trim()).filter(Boolean));

/** Stable fingerprint of one specific collision — the losing text included. */
function fingerprint(message: string): string {
  return createHash('sha1').update(message).digest('hex').slice(0, 12);
}

/**
 * Operations whose manifest `type` disagrees with the HTTP verb Google uses, deliberately.
 * Each needs a reason, because the pair is what tells read from write.
 */
const TYPE_EXCEPTIONS: Record<string, string> = {
  'calendar.freebusy': 'a read shaped as POST — freebusy.query sends its time range in a body',
  'drive.export': 'declared an action because it writes a local file, but the API call is a GET',
  'gmail.archive': 'declared an action because it writes a local markdown file, but the API call is a GET',
};

describe('manifest type vs the HTTP verb Google uses', () => {
  it('declares list/detail for reads and action for writes', async () => {
    // `type` is the declared intent; httpMethod is what Google actually does. ADR-202
    // enforces access from the descriptor, so an operation whose `type` misdescribes it
    // is an operation the access policy will get wrong — a write let through as a read,
    // or a read refused to an account entitled to it.
    //
    // Catching that here means it fails the suite instead of at somebody's call site.
    const manifest = loadManifest();
    const descriptor = await loadDescriptor();
    const disagreements: string[] = [];

    for (const [serviceName, service] of Object.entries(manifest.services)) {
      for (const [opName, op] of Object.entries(service.operations)) {
        const method = descriptor.services[service.google_service ?? serviceName]?.methods?.[op.resource ?? ''];
        if (!method) continue;   // custom handler with no single resource behind it

        const key = `${serviceName}.${opName}`;
        if (key in TYPE_EXCEPTIONS) continue;

        const declaredRead = op.type === 'list' || op.type === 'detail';
        const actuallyRead = method.httpMethod === 'GET';
        if (declaredRead !== actuallyRead) {
          disagreements.push(
            `${key}: type='${op.type}' says ${declaredRead ? 'read' : 'write'}, ` +
            `but ${method.httpMethod} ${op.resource} is a ${actuallyRead ? 'read' : 'write'}. ` +
            `Fix the type, or add it to TYPE_EXCEPTIONS with a reason.`,
          );
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  /**
   * The operations the test above cannot check, pinned by hand — because `type` is their
   * ONLY enforcement input.
   *
   * They declare no `resource`: each is a custom handler making several calls, so there is
   * no single descriptor method to compare against and the loop above skips them on
   * `if (!method) continue`. That skip lands precisely where the access policy has nothing
   * else to go on (src/factory/safety.ts, requiredScopes), so `type: action` here is what
   * stands between a read-only account and a send.
   *
   * Changing gmail.send to `type: list` would otherwise disable enforcement for
   * send/reply/replyAll/forward with the whole suite still green.
   */
  const RESOURCE_LESS: Record<string, 'list' | 'detail' | 'action'> = {
    'calendar.agenda': 'list',
    'calendar.create': 'action',
    'drive.upload': 'action',
    'gmail.send': 'action',
    'gmail.reply': 'action',
    'gmail.replyAll': 'action',
    'gmail.forward': 'action',
  };

  it('pins the type of every operation with no resource behind it', () => {
    const manifest = loadManifest();
    const found: Record<string, string> = {};

    for (const [serviceName, service] of Object.entries(manifest.services)) {
      for (const [opName, op] of Object.entries(service.operations)) {
        if (!op.resource) found[`${serviceName}.${opName}`] = op.type;
      }
    }

    // Equality, not containment. A NEW resource-less operation has to be added here
    // deliberately — with its type stated — rather than defaulting to unenforced.
    expect(found).toEqual(RESOURCE_LESS);
  });

  it('keeps every exception real', async () => {
    // An exception left behind after its operation changed would quietly excuse a genuine
    // disagreement. Each one has to still be a disagreement.
    const manifest = loadManifest();
    const descriptor = await loadDescriptor();
    const stale: string[] = [];

    for (const key of Object.keys(TYPE_EXCEPTIONS)) {
      const [serviceName, opName] = key.split('.');
      const op = manifest.services[serviceName]?.operations?.[opName];
      if (!op) { stale.push(`${key}: no such operation`); continue; }
      // Resolve through google_service, not the manifest filename. They differ:
      // contacts.yaml declares `google_service: people`, so keying the descriptor by
      // the filename would report a live exception as stale the moment one was added
      // for a service whose two names disagree.
      const service = manifest.services[serviceName];
      const method = descriptor.services[service.google_service ?? serviceName]?.methods?.[op.resource ?? ''];
      if (!method) { stale.push(`${key}: no descriptor method`); continue; }

      const declaredRead = op.type === 'list' || op.type === 'detail';
      if (declaredRead === (method.httpMethod === 'GET')) {
        stale.push(`${key}: now agrees — remove it from TYPE_EXCEPTIONS`);
      }
    }

    expect(stale).toEqual([]);
  });
});

/**
 * Params whose manifest enum is deliberately NOT Google's vocabulary, because a
 * beforeExecute hook translates it before the call.
 *
 * The check does not go away for these — it moves to the far side of the translation.
 * The entry names the real map, so what gets verified is what production sends, and a
 * translation that stopped covering an advertised value fails here.
 */
const TRANSLATED_ENUMS: Record<string, Record<string, string>> = {
  'contacts.list.sortOrder': SORT_ORDERS,
};

describe('manifest enums against the values Google declares', () => {
  it('translates every value it advertises, into one Google declares', async () => {
    const manifest = loadManifest();
    const descriptor = await loadDescriptor();
    const wrong: string[] = [];

    for (const [key, translation] of Object.entries(TRANSLATED_ENUMS)) {
      const [serviceName, opName, paramName] = key.split('.');
      const service = manifest.services[serviceName];
      const op = service?.operations?.[opName];
      const def = op?.params?.[paramName] as { enum?: string[]; maps_to?: string } | undefined;
      if (!def?.enum?.length) { wrong.push(`${key}: no such param, or it declares no enum`); continue; }

      const target = def.maps_to ?? paramName;
      const allowed = descriptor.services[service.google_service ?? serviceName]
        ?.methods?.[op.resource ?? '']?.parameters?.[target]?.enum;
      if (!allowed?.length) { wrong.push(`${key}: Google declares no enum for '${target}'`); continue; }

      // Advertised but untranslated is the failure that matters: the value reaches
      // Google verbatim and is rejected, having been offered by our own schema.
      for (const advertised of def.enum) {
        const sent = translation[advertised];
        if (!sent) wrong.push(`${key}: advertises '${advertised}', which the translation does not map`);
        else if (!allowed.includes(sent)) wrong.push(`${key}: '${advertised}' translates to '${sent}', which Google does not accept`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('never offers the model a value Google would reject', async () => {
    // The descriptor now carries enum values — from method parameters and from schema
    // properties — because request BODIES were otherwise unchecked by anything here. A
    // handler that sent `MODERATION_ON` where Google wanted `ON` passed lint,
    // type-check and the whole suite, and was found only by calling Google.
    //
    // Where Google declares an enum for a field of the same name, ours must be a subset
    // of it. Where Google declares none, there is nothing to check and this stays quiet
    // rather than inventing a rule.
    const manifest = loadManifest();
    const descriptor = await loadDescriptor();
    const wrong: string[] = [];

    for (const [serviceName, service] of Object.entries(manifest.services)) {
      // Keyed by the manifest's own google_service, not the record key: they coincide
      // today, and a guard that silently skips a whole service when they diverge is a
      // guard whose failure mode is silence.
      const svc = descriptor.services[service.google_service ?? serviceName];
      if (!svc) continue;

      for (const [opName, op] of Object.entries(service.operations)) {
        for (const [paramName, def] of Object.entries(op.params ?? {})) {
          const ours = (def as { enum?: string[] }).enum;
          if (!ours?.length) continue;
          // Checked on the far side of its translation by the test above.
          if (`${serviceName}.${opName}.${paramName}` in TRANSLATED_ENUMS) continue;

          const target = (def as { maps_to?: string }).maps_to ?? paramName;
          const fromParam = svc?.methods?.[op.resource ?? '']?.parameters?.[target]?.enum;
          const fromSchema = Object.entries(svc?.enums ?? {})
            .filter(([key]) => key.split('.').pop() === target)
            .map(([, values]) => values);

          const candidates = fromParam ? [fromParam] : fromSchema;
          if (candidates.length === 0) continue;   // Google declares nothing for this name

          // Several schemas can declare a field of the same name with different values
          // (sheets has ten distinct `type` enums). Accept a match against ANY of them
          // rather than picking the first and reporting a false failure.
          const satisfied = candidates.some(allowed => ours.every(v => allowed.includes(v)));
          if (!satisfied) {
            wrong.push(
              `${serviceName}.${opName}.${paramName}: offers ${JSON.stringify(ours)}, ` +
              `no declaration Google makes for '${target}' contains all of them ` +
              `(${candidates.length} candidate(s), e.g. ${JSON.stringify(candidates[0])})`,
            );
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe('generateSchema — one declaration per param name', () => {
  it('never declares a param name twice with different wording, type, or enum', () => {
    // generateSchema flattens every operation's params into ONE schema and keeps the
    // FIRST declaration of each name — later ones are dropped with no warning. So a
    // param used by several operations is described to the model exactly once, by
    // whichever operation happens to appear first in the YAML.
    //
    // That is how `manage_docs.tabId` shipped telling the model "Read only this tab",
    // its `get` wording, on the three WRITE operations where omitting it means the edit
    // lands in the first tab (#157). The warning existed in the manifest and never
    // reached the schema. `type` and `enum` are dropped by the same line, so they are
    // checked here too.
    //
    // The allowlist is empty (#161), so any collision fails here. It keys on a
    // FINGERPRINT of the losing text rather than the param name, because a name-keyed
    // entry would permit a future third, materially different description for that same
    // param forever.
    //
    // The fix for a failure is to harmonize the description — ONE text naming the
    // operations where meaning actually diverges, as every manifest now does — not to
    // freeze the collision.
    const manifest = loadManifest();
    const conflicts: string[] = [];

    for (const [serviceName, service] of Object.entries(manifest.services)) {
      const seen = new Map<string, { op: string; def: Record<string, unknown> }>();
      for (const [opName, op] of Object.entries(service.operations)) {
        for (const [paramName, def] of Object.entries(op.params ?? {})) {
          const prior = seen.get(paramName);
          if (!prior) {
            seen.set(paramName, { op: opName, def: def as unknown as Record<string, unknown> });
            continue;
          }
          for (const field of ['description', 'type', 'enum'] as const) {
            const a = JSON.stringify(prior.def[field] ?? null);
            const b = JSON.stringify((def as unknown as Record<string, unknown>)[field] ?? null);
            if (a === b) continue;
            const message =
              `${serviceName}.${paramName}.${field}: ${prior.op} says ${a} ` +
              `but ${opName} says ${b} — only ${prior.op}'s reaches the model.`;
            if (!KNOWN_COLLISIONS.has(fingerprint(message))) {
              conflicts.push(`${fingerprint(message)}  ${message}`);
            }
          }
        }
      }
    }

    expect(conflicts).toEqual([]);
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
    expect(names).toContain('manage_contacts');
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
    // An operation is a manifest resource op or a custom handler — there is no
    // third kind, so nothing is left for the generator's else-branch to call. The
    // behaviour worth pinning is that such an op FAILS LOUDLY rather than silently
    // doing nothing.
    const orphan: ServiceDef = {
      tool_name: 'manage_orphan',
      description: 'a service with an unroutable operation',
      requires_email: true,
      google_service: 'gmail',
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
    // triage is a resource op (users.messages.list with an unread query) whose
    // afterExecute hydrates the bare IDs Google returns. The formatter therefore
    // reads REAL Gmail shapes.
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
    // reply/replyAll build an RFC 5322 message themselves (src/services/gmail/mail.ts)
    // and upload it, so the assertions look at the two things that decide what the
    // user gets: WHICH endpoint (users.drafts.create vs users.messages.send) and WHAT
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

      // Attachments imply a draft — a deliberate safety choice, not a technical
      // limit (the client can send attachments outright).
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
      // In-Reply-To + References are what make a reply land in the conversation
      // rather than start a new one, so they get asserted.
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
      // Nothing was sent — the workspace fence rejected the path.
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

describe('batch declarations', () => {
  // Same discipline as `resource`: a batch resource that does not exist in the descriptor
  // is a method we would call and Google would reject, discoverable only live. ADR-308.
  it('every batch resource is a method Google declares', async () => {
    const manifest = loadManifest();
    const descriptor = await loadDescriptor();
    const bad: string[] = [];

    for (const [serviceName, service] of Object.entries(manifest.services)) {
      for (const [opName, op] of Object.entries(service.operations)) {
        if (!op.batch) continue;
        const method = descriptor.services[service.google_service]?.methods?.[op.batch.resource];
        if (!method) bad.push(`${serviceName}.${opName}: no such method ${op.batch.resource}`);
      }
    }

    expect(bad).toEqual([]);
  });

  it('only declares batch where the operation itself exists', () => {
    // A batch block on an operation with no `resource` would be a bulk form of something
    // that has no singular form — nothing for a caller to graduate from.
    const manifest = loadManifest();
    for (const service of Object.values(manifest.services)) {
      for (const [opName, op] of Object.entries(service.operations)) {
        if (op.batch) expect(op.resource, `${opName} declares batch but no resource`).toBeTruthy();
      }
    }
  });
});

describe('batch declarations supply what Google requires', () => {
  // Found live: users.messages.batchModify takes a `userId` PATH parameter, and batch
  // mode reads only the batch block's defaults — not the operation's. The call failed
  // with "missing required path param 'userId'" after passing every offline test.
  //
  // Derived from the descriptor rather than listed, so a new batch method with a required
  // path parameter is caught before it reaches Google.
  it('every required path param of a batch method has a default', async () => {
    const manifest = loadManifest();
    const descriptor = await loadDescriptor();
    const missing: string[] = [];

    for (const [serviceName, service] of Object.entries(manifest.services)) {
      for (const [opName, op] of Object.entries(service.operations)) {
        if (!op.batch) continue;
        const method = descriptor.services[service.google_service]?.methods?.[op.batch.resource];
        if (!method) continue;   // covered by the resource-resolves test

        for (const [param, def] of Object.entries(method.parameters ?? {})) {
          if (def.location !== 'path' || !def.required) continue;
          if (op.batch.defaults?.[param] === undefined) {
            missing.push(`${serviceName}.${opName}: ${op.batch.resource} needs path param '${param}'`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
