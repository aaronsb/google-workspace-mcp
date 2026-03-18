/**
 * Tests for server.ts MCP wiring.
 *
 * We mock the MCP SDK (ESM-only) and verify that createServer
 * wires handlers correctly and maps responses/errors.
 */

// Mock registry before any server imports — avoids import.meta.url in Jest
jest.mock('../../factory/registry.js', () => {
  const { loadManifest, generateTools } = jest.requireActual('../../factory/generator.js');
  const { patches } = jest.requireActual('../../factory/patches.js');
  const manifest = loadManifest();
  return { manifest, generatedTools: generateTools(manifest, patches) };
});

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

jest.mock('../../server/handler.js');

import { createServer } from '../../server/server.js';
import { handleToolCall } from '../../server/handler.js';
import { GwsError, GwsExitCode } from '../../executor/errors.js';
import type { HandlerResponse } from '../../server/handler.js';

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

    it('maps GwsError to structured isError response', async () => {
      mockHandleToolCall.mockRejectedValue(
        new GwsError('Token expired', GwsExitCode.AuthError, 'authError', 'stderr: token invalid'),
      );

      const result = await callToolHandler({
        params: { name: 'manage_email', arguments: { operation: 'triage', email: 'u@t.com' } },
      });

      expect(result.isError).toBe(true);
      const text = result.content[0].text as string;
      // Error JSON is followed by auth remediation guidance
      expect(text).toContain('"error": "Token expired"');
      expect(text).toContain(`"exitCode": ${GwsExitCode.AuthError}`);
      expect(text).toContain('"reason": "authError"');
      // Auth error should include remediation guidance
      expect(text).toContain('**Next steps:**');
      expect(text).toContain('Re-authenticate');
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
