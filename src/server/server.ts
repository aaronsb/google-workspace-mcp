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

function log(msg: string): void {
  process.stderr.write(`[gws-mcp] ${msg}\n`);
}

export function createServer(): Server {
  log(`startup: ${toolSchemas.length} tools loaded`);

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
      log(`call: ${name} ${JSON.stringify(args ?? {}).slice(0, 200)}`);
      const result = await handleToolCall(name, (args ?? {}) as Record<string, unknown>);
      log(`done: ${name}`);
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

/** Warm up credentials on startup — validates accounts and refreshes tokens. */
async function warmupAccounts(): Promise<void> {
  try {
    const { listAccounts } = await import('../accounts/registry.js');
    const accounts = await listAccounts();
    if (accounts.length === 0) {
      log('startup: no accounts configured');
      return;
    }
    log(`startup: warming ${accounts.length} account(s)`);
    for (const account of accounts) {
      const email = account.email;
      try {
        const { hasCredential } = await import('../accounts/credentials.js');
        if (await hasCredential(email)) {
          const { execute } = await import('../executor/gws.js');
          await execute(
            ['gmail', 'users', 'getProfile', '--params', JSON.stringify({ userId: 'me' })],
            { account: email },
          );
          log(`startup: ${email} — token valid`);
        } else {
          log(`startup: ${email} — no credential file`);
        }
      } catch (err) {
        log(`startup: ${email} — token invalid (${(err as Error).message})`);
      }
    }
  } catch (err) {
    log(`startup: warmup failed (${(err as Error).message})`);
  }
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Non-blocking warmup — don't delay MCP handshake
  warmupAccounts().catch(() => {});
}
