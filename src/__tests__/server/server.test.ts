/**
 * Tests for server.ts MCP wiring.
 *
 * We mock the MCP SDK (ESM-only) and verify that createServer
 * wires handlers correctly and maps responses/errors.
 */
import { beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction, type Mock } from 'vitest';


// vi.mock is hoisted above module-level consts, so the factory's captures must
// come from vi.hoisted() to exist by the time the factory runs.
const { mockSetRequestHandler, mockServerConnect } = vi.hoisted(() => ({
  mockSetRequestHandler: vi.fn(),
  mockServerConnect: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  // Must be a function, not an arrow: vitest applies `new` to the implementation.
  Server: vi.fn(function () {
    return {
      setRequestHandler: mockSetRequestHandler,
      connect: mockServerConnect,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

// Every schema server.ts imports must appear here. Under Jest a missing export
// silently read as undefined and the handler registered under an undefined key;
// vitest fails loudly instead.
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  ListResourcesRequestSchema: 'ListResourcesRequestSchema',
  ReadResourceRequestSchema: 'ReadResourceRequestSchema',
}));

vi.mock('../../server/handler.js');

import { createServer } from '../../server/server.js';
import { handleToolCall } from '../../server/handler.js';
import { GoogleApiError } from '../../google/errors.js';
import type { HandlerResponse } from '../../server/handler.js';

const mockHandleToolCall = handleToolCall as MockedFunction<typeof handleToolCall>;

describe('createServer', () => {
  let listToolsHandler: (request: any) => Promise<any>;
  let callToolHandler: (request: any) => Promise<any>;

  beforeAll(() => {
    createServer();

    // Extract handlers by schema key, not registration order
    for (const [schema, handler] of mockSetRequestHandler.mock.calls) {
      if (schema === 'ListToolsRequestSchema') listToolsHandler = handler;
      if (schema === 'CallToolRequestSchema') callToolHandler = handler;
    }
  });

  beforeEach(() => {
    mockHandleToolCall.mockReset();
  });

  it('registers ListTools and CallTool handlers', () => {
    expect(listToolsHandler).toBeInstanceOf(Function);
    expect(callToolHandler).toBeInstanceOf(Function);
  });

  describe('ListTools handler', () => {
    it('returns all 5 tool schemas', async () => {
      const result = await listToolsHandler({});
      const names = result.tools.map((t: any) => t.name);
      expect(names).toContain('manage_accounts');
      expect(names).toContain('manage_email');
      expect(names).toContain('manage_sheets');
      expect(names).toContain('manage_tasks');
      expect(names.length).toBeGreaterThanOrEqual(8);
    });

    it('each tool has name, description, and inputSchema', async () => {
      const result = await listToolsHandler({});
      for (const tool of result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      }
    });
  });

  describe('CallTool handler', () => {
    it('returns markdown text content on success', async () => {
      const response: HandlerResponse = { text: '## Messages (1)\n\nmsg-1 | alice', refs: { count: 1 } };
      mockHandleToolCall.mockResolvedValue(response);

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: { operation: 'triage', email: 'u@t.com' } },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toBe('## Messages (1)\n\nmsg-1 | alice');
      expect(result.isError).toBeUndefined();
    });

    // The error surface is Google's now, not a subprocess's. This used to assert on
    // `exitCode: 2` — a number a CLI made up — and on scraped stderr. It now asserts
    // on the HTTP status and the reason Google itself states (ADR-103 item 7).
    const googleError = (status: number, message: string, reason: string) =>
      new GoogleApiError(
        status,
        { error: { code: status, message, errors: [{ reason }] } },
        { url: 'https://gmail.googleapis.com/…', method: 'GET' },
      );

    it('maps a 401 to a structured error WITH auth remediation', async () => {
      mockHandleToolCall.mockRejectedValue(
        googleError(401, 'Invalid Credentials', 'authError'),
      );

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: { operation: 'triage', email: 'u@t.com' } },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text as string;
      expect(text).toContain('"error": "Invalid Credentials"');   // Google's own message
      expect(text).toContain('"status": 401');                    // the real status
      expect(text).toContain('"reason": "authError"');
      expect(text).toContain('**Next steps:**');
      expect(text).toContain('Re-authenticate');
    });

    it('maps a 403 SCOPE failure to auth remediation too — it is not a 401, but it is fixed by re-consenting', async () => {
      // The case the old exit-code check could not distinguish. The token is VALID;
      // it just does not carry the scope this call needs. Telling the user "error"
      // and nothing else strands them, because the fix is the same as for a 401.
      mockHandleToolCall.mockRejectedValue(
        googleError(403, 'Request had insufficient authentication scopes.', 'insufficientPermissions'),
      );

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: { operation: 'triage', email: 'u@t.com' } },
      });

      const text = result.content[0].text as string;
      expect(text).toContain('"status": 403');
      expect(text).toContain('**Next steps:**');
      expect(text).toContain('Re-authenticate');
    });

    it('does NOT offer auth remediation for an error that re-authenticating cannot fix', async () => {
      // A 404 is not an auth problem. Telling the user to re-authenticate would send
      // them round a loop that cannot help.
      mockHandleToolCall.mockRejectedValue(
        googleError(404, 'File not found: abc123.', 'notFound'),
      );

      const result = await callToolHandler({
        params: { name: 'manage_drive', arguments: { operation: 'get', email: 'u@t.com', fileId: 'abc123' } },
      });

      const text = result.content[0].text as string;
      expect(text).toContain('"status": 404');
      expect(text).toContain('"reason": "notFound"');
      expect(text).not.toContain('Re-authenticate');
    });

    it('maps generic Error to plain error message', async () => {
      mockHandleToolCall.mockRejectedValue(new Error('Something broke'));

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: Something broke');
    });

    it('handles non-Error thrown values', async () => {
      mockHandleToolCall.mockRejectedValue('string error');

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: string error');
    });

    it('passes arguments to handleToolCall', async () => {
      mockHandleToolCall.mockResolvedValue({ text: 'ok', refs: {} });

      await callToolHandler({
        params: { name: 'manage_drive', arguments: { operation: 'search', email: 'u@t.com' } },
      });

      expect(mockHandleToolCall).toHaveBeenCalledWith('manage_drive', {
        operation: 'search',
        email: 'u@t.com',
      });
    });

    it('defaults to empty object when arguments are undefined', async () => {
      mockHandleToolCall.mockResolvedValue({ text: 'ok', refs: {} });

      await callToolHandler({
        params: { name: 'manage_accounts' },
      });

      expect(mockHandleToolCall).toHaveBeenCalledWith('manage_accounts', {});
    });
  });
});
