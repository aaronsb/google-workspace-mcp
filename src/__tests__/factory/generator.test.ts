import { loadManifest, generateTools, generateSchema, generateHandler } from '../../factory/generator.js';
import { patches } from '../../factory/patches.js';
import type { Manifest, ServiceDef } from '../../factory/types.js';

// Mock executor for handler tests
jest.mock('../../executor/gws.js');
import { execute } from '../../executor/gws.js';
const mockExecute = execute as jest.MockedFunction<typeof execute>;

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
    mockExecute.mockReset();
  });

  it('calls execute with correct args for resource-based operations', async () => {
    mockExecute.mockResolvedValue({ success: true, data: { files: [] }, stderr: '' });
    const handler = generateHandler(manifest.services.drive, patches.drive);

    await handler({ operation: 'search', email: 'u@t.com', query: 'budget' });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.arrayContaining(['drive', 'files', 'list']),
      expect.objectContaining({ account: 'u@t.com' }),
    );
  });

  it('calls execute with correct args for helper-based operations', async () => {
    mockExecute.mockResolvedValue({ success: true, data: { messages: [] }, stderr: '' });
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    await handler({ operation: 'triage', email: 'u@t.com' });

    expect(mockExecute).toHaveBeenCalledWith(
      ['gmail', '+triage'],
      expect.objectContaining({ account: 'u@t.com' }),
    );
  });

  it('uses patch formatList when available', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { messages: [{ id: 'msg-1', from: 'alice', subject: 'hi', date: '2024-01-01' }] },
      stderr: '',
    });
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    const result = await handler({ operation: 'triage', email: 'u@t.com' });

    // Gmail patch uses formatEmailList which produces pipe-delimited format
    expect(result.text).toContain('msg-1');
    expect(result.text).toContain('|');
  });

  it('delegates to customHandler when defined', async () => {
    // Gmail send is a custom handler
    mockExecute.mockResolvedValue({
      success: true,
      data: { id: 'sent-1', threadId: 'thread-1' },
      stderr: '',
    });
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    const result = await handler({
      operation: 'send',
      email: 'u@t.com',
      to: 'bob@t.com',
      subject: 'hello',
      body: 'hi bob',
    });

    expect(result.text).toContain('Email sent to bob@t.com');
    expect(result.refs).toHaveProperty('to', 'bob@t.com');
  });

  it('passes from alias to Gmail send customHandler', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      data: { id: 'sent-1', threadId: 'thread-1' },
      stderr: '',
    });
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    await handler({
      operation: 'send',
      email: 'u@t.com',
      to: 'bob@t.com',
      subject: 'hello',
      body: 'hi bob',
      from: 'Agent Name <agent@example.com>',
    });

    const args = mockExecute.mock.calls[0][0];
    expect(args).toContain('--from');
    expect(args[args.indexOf('--from') + 1]).toBe('Agent Name <agent@example.com>');
  });

  it('throws on unknown operation', async () => {
    const handler = generateHandler(manifest.services.gmail, patches.gmail);

    await expect(
      handler({ operation: 'nonexistent', email: 'u@t.com' }),
    ).rejects.toThrow('Unknown gmail operation: nonexistent');
  });

  it('applies afterExecute hook for gmail search hydration', async () => {
    // First call: messages.list returns IDs
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { messages: [{ id: 'msg-1' }, { id: 'msg-2' }] },
      stderr: '',
    });
    // Hydration calls for each message
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-1', threadId: 't1', snippet: 'hello',
        payload: { headers: [
          { name: 'From', value: 'alice@t.com' },
          { name: 'Subject', value: 'Meeting' },
          { name: 'Date', value: '2024-01-15' },
        ]},
      },
      stderr: '',
    });
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-2', threadId: 't2', snippet: 'world',
        payload: { headers: [
          { name: 'From', value: 'bob@t.com' },
          { name: 'Subject', value: 'Update' },
          { name: 'Date', value: '2024-01-16' },
        ]},
      },
      stderr: '',
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

  beforeEach(() => mockExecute.mockReset());

  it('appends next-steps to a custom handler response', async () => {
    // sheets.addSheet is a customHandler — its handler return has no footer,
    // but the factory should wrap with one from the next-steps registry.
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{ addSheet: { properties: { sheetId: 42, title: 'T', gridProperties: {} } } }] },
      stderr: '',
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
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{}] },
      stderr: '',
    });

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
    mockExecute.mockResolvedValueOnce({
      success: true,
      data: { replies: [{ addSheet: { properties: { sheetId: 99, title: 'Q', gridProperties: {} } } }] },
      stderr: '',
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
