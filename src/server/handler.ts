import { handleAccounts } from './handlers/accounts.js';
import { handleWorkspace } from './handlers/workspace.js';
import { handleScratchpad } from './scratchpad/handler.js';
import { handleQueue } from './queue.js';
import { generatedTools } from '../factory/registry.js';

export type { HandlerResponse } from './formatting/markdown.js';
import type { HandlerResponse } from './formatting/markdown.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<HandlerResponse>;

// ── Epoch counter ─────────────────────────────────────────
// Server-wide monotonic counter incremented on every tool call.
// Used by ScratchpadManager for activity-based garbage collection.

let epoch = 0;

/** Current epoch value. */
export function getEpoch(): number {
  return epoch;
}

/** Increment and return the new epoch. Called once per tool dispatch. */
export function advanceEpoch(): number {
  return ++epoch;
}

// ── Handler dispatch ──────────────────────────────────────

const domainHandlers: Record<string, ToolHandler> = {
  manage_accounts: handleAccounts,
  manage_workspace: handleWorkspace,
  manage_scratchpad: handleScratchpad,
};

// Register factory-generated handlers
for (const tool of generatedTools) {
  domainHandlers[tool.schema.name] = tool.handler;
}

export async function handleToolCall(
  toolName: string,
  params: Record<string, unknown>,
): Promise<HandlerResponse> {
  advanceEpoch();

  // Queue wraps the domain handlers (each queued op also advances the epoch)
  if (toolName === 'queue_operations') {
    return handleQueue(params, domainHandlers);
  }

  const handler = domainHandlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return handler(params);
}
