import { handleAccounts } from './handlers/accounts.js';
import { handleQueue } from './queue.js';
import { loadManifest, generateTools } from '../factory/generator.js';
import { patches } from '../factory/patches.js';

export type { HandlerResponse } from './formatting/markdown.js';
import type { HandlerResponse } from './formatting/markdown.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<HandlerResponse>;

// Factory-generated handlers for manifest-declared services
const manifest = loadManifest();
const generatedTools = generateTools(manifest, patches);

const domainHandlers: Record<string, ToolHandler> = {
  manage_accounts: handleAccounts,
};

// Register factory-generated handlers
for (const tool of generatedTools) {
  domainHandlers[tool.schema.name] = tool.handler;
}

export async function handleToolCall(
  toolName: string,
  params: Record<string, unknown>,
): Promise<HandlerResponse> {
  // Queue wraps the domain handlers
  if (toolName === 'queue_operations') {
    return handleQueue(params, domainHandlers);
  }

  const handler = domainHandlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return handler(params);
}
