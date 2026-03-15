/**
 * Tests for server.ts MCP wiring.
 *
 * We can't import server.ts directly because the MCP SDK is ESM-only
 * and Jest's CJS transform can't handle it cleanly. Instead we mock
 * the SDK and verify that createServer wires handlers correctly.
 */

// Mock the MCP SDK before any imports
const mockSetRequestHandler = jest.fn();
const mockServerConnect = jest.fn();

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: mockSetRequestHandler,
    connect: mockServerConnect,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}));

// Mock handler to control tool responses
jest.mock('../../server/handler.js');

import { createServer } from '../../server/server.js';
import { handleToolCall } from '../../server/handler.js';
import { GwsError, GwsExitCode } from '../../executor/errors.js';

const mockHandleToolCall = handleToolCall as jest.MockedFunction<typeof handleToolCall>;

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
    // Handlers were captured in beforeAll — verify they exist and are callable
    expect(listToolsHandler).toBeInstanceOf(Function);
    expect(callToolHandler).toBeInstanceOf(Function);
  });

  describe('ListTools handler', () => {
    it('returns all 5 tool schemas', async () => {
      const result = await listToolsHandler({});
      const names = result.tools.map((t: any) => t.name);
      expect(names).toEqual([
        'manage_accounts',
        'manage_email',
        'manage_calendar',
        'manage_drive',
        'queue_operations',
      ]);
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
    it('returns JSON content on success', async () => {
      mockHandleToolCall.mockResolvedValue({ emails: [], count: 0 });

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: { operation: 'triage', email: 'u@t.com' } },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(JSON.parse(result.content[0].text)).toEqual({ emails: [], count: 0 });
      expect(result.isError).toBeUndefined();
    });

    it('maps GwsError to structured isError response', async () => {
      mockHandleToolCall.mockRejectedValue(
        new GwsError('Token expired', GwsExitCode.AuthError, 'authError', 'stderr: token invalid'),
      );

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: { operation: 'triage', email: 'u@t.com' } },
      });

      expect(result.isError).toBe(true);
      const body = JSON.parse(result.content[0].text);
      expect(body.error).toBe('Token expired');
      expect(body.exitCode).toBe(GwsExitCode.AuthError);
      expect(body.reason).toBe('authError');
      expect(body.stderr).toBe('stderr: token invalid');
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
      mockHandleToolCall.mockResolvedValue({});

      await callToolHandler({
        params: { name: 'manage_drive', arguments: { operation: 'search', email: 'u@t.com' } },
      });

      expect(mockHandleToolCall).toHaveBeenCalledWith('manage_drive', {
        operation: 'search',
        email: 'u@t.com',
      });
    });

    it('defaults to empty object when arguments are undefined', async () => {
      mockHandleToolCall.mockResolvedValue({});

      await callToolHandler({
        params: { name: 'manage_accounts' },
      });

      expect(mockHandleToolCall).toHaveBeenCalledWith('manage_accounts', {});
    });
  });
});
