import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolSchemas } from './tools.js';
import { handleToolCall } from './handler.js';
import { GwsError, GwsExitCode } from '../executor/errors.js';
import { nextSteps } from './formatting/next-steps.js';
import { manifest } from '../factory/registry.js';
import { checkWorkspaceStatus } from '../executor/workspace.js';
import { VERSION } from '../version.js';

import {
  configurePolicies,
  getActivePolicies,
  draftOnlyEmail,
  noDelete,
  readOnly,
  auditLog,
  type SafetyPolicy,
} from '../factory/safety.js';

function log(msg: string): void {
  process.stderr.write(`[gws-mcp] ${msg}\n`);
}

/** Configure safety policies from GWS_SAFETY_POLICY env var. */
function initSafetyPolicies(): void {
  const policyEnv = process.env.GWS_SAFETY_POLICY || '';
  if (!policyEnv) return;

  const policyMap: Record<string, SafetyPolicy> = {
    'draft-only-email': draftOnlyEmail,
    'no-delete': noDelete,
    'read-only': readOnly,
    'audit': auditLog,
  };

  const names = policyEnv.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = names.filter(name => !policyMap[name]);
  if (unknown.length > 0) {
    const valid = Object.keys(policyMap).join(', ');
    throw new Error(
      `Unknown safety policy(ies): ${unknown.join(', ')}. ` +
      `Valid policies: ${valid}`,
    );
  }

  const policies = names.map(name => policyMap[name]);
  configurePolicies(policies);
}

export function createServer(): Server {
  initSafetyPolicies();
  log(`startup: ${toolSchemas.length} tools loaded`);

  const server = new Server(
    {
      name: '@aaronsb/google-workspace-mcp',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
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
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: result.text }];
      if (result.content) {
        for (const block of result.content) {
          content.push({ type: block.type, data: block.data, mimeType: block.mimeType });
        }
      }
      return { content };
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

  // --- Resources ---

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'gws://safety/policies',
          name: 'Active Safety Policies',
          description: 'Current safety policies controlling what operations are allowed, blocked, or audited',
          mimeType: 'application/json',
        },
        {
          uri: 'gws://config/services',
          name: 'Available Services',
          description: 'Google Workspace services and operations available through this server',
          mimeType: 'application/json',
        },
        {
          uri: 'gws://config/workspace',
          name: 'Workspace Directory',
          description: 'File I/O workspace directory status and path',
          mimeType: 'application/json',
        },
        {
          uri: 'gws://config/version',
          name: 'Server Version',
          description: 'Build version of the google-workspace-mcp server',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    switch (uri) {
      case 'gws://safety/policies': {
        const policies = getActivePolicies();
        const content = {
          active: policies.length > 0,
          policies: policies.map(p => ({
            name: p.name,
            description: p.description,
          })),
          summary: policies.length === 0
            ? 'No safety policies active — all operations are allowed.'
            : `${policies.length} policy(ies) active: ${policies.map(p => p.name).join(', ')}. ` +
              'Operations that violate these policies will be blocked with an explanation.',
        };
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(content, null, 2),
          }],
        };
      }

      case 'gws://config/services': {
        const services = Object.entries(manifest.services).map(([name, def]) => ({
          service: name,
          tool: def.tool_name,
          operations: Object.keys(def.operations),
          operationCount: Object.keys(def.operations).length,
        }));
        const content = {
          totalServices: services.length,
          totalOperations: services.reduce((sum, s) => sum + s.operationCount, 0),
          services,
        };
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(content, null, 2),
          }],
        };
      }

      case 'gws://config/workspace': {
        const status = checkWorkspaceStatus();
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2),
          }],
        };
      }

      case 'gws://config/version': {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ name: '@aaronsb/google-workspace-mcp', version: VERSION }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return server;
}

/** Warm up token cache on startup — prefetch access tokens for all accounts. */
async function warmupAccounts(): Promise<void> {
  try {
    const { listAccounts } = await import('../accounts/registry.js');
    const { hasCredential } = await import('../accounts/credentials.js');
    const { warmTokenCache } = await import('../accounts/token-service.js');
    const accounts = await listAccounts();
    if (accounts.length === 0) {
      log('startup: no accounts configured');
      return;
    }
    const withCreds: string[] = [];
    for (const account of accounts) {
      if (await hasCredential(account.email)) {
        withCreds.push(account.email);
      } else {
        log(`startup: ${account.email} — no credential file`);
      }
    }
    if (withCreds.length > 0) {
      log(`startup: warming tokens for ${withCreds.length} account(s)`);
      await warmTokenCache(withCreds);
      log(`startup: token warmup complete`);
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
