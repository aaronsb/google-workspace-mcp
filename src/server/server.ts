import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolSchemas } from './tools.js';
import { handleToolCall } from './handler.js';
import { GwsError, GwsExitCode } from '../executor/errors.js';
import { nextSteps } from './formatting/next-steps.js';

export function createServer(): Server {
  const server = new Server(
    {
      name: '@aaronsb/google-workspace-mcp',
      version: '2.0.0-alpha.1',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolSchemas.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, (args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: result.text }],
      };
    } catch (err) {
      if (err instanceof GwsError) {
        // Append auth remediation guidance for auth errors
        const email = (args as Record<string, unknown>)?.email as string | undefined;
        const guidance = err.exitCode === GwsExitCode.AuthError
          ? nextSteps('accounts', 'auth_error', email ? { email } : undefined)
          : '';
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: err.message,
            exitCode: err.exitCode,
            reason: err.reason,
            stderr: err.stderr,
          }, null, 2) + guidance }],
          isError: true,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
