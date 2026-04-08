import { handleAccounts } from './handlers/accounts.js';
import { handleWorkspace } from './handlers/workspace.js';
import { handleScratchpad } from './scratchpad/handler.js';
import { handleQueue } from './queue.js';
import { generatedTools } from '../factory/registry.js';
import { getSessionTracker, sessionContext } from './session/index.js';

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
  const currentEpoch = advanceEpoch();
  const tracker = getSessionTracker();

  // Queue wraps the domain handlers (each queued op also advances the epoch)
  if (toolName === 'queue_operations') {
    const result = await handleQueue(params, domainHandlers);
    const queueEmail = extractEmailFromQueue(params);
    if (queueEmail) {
      await tracker.ensureBaseline(queueEmail, currentEpoch);
      tracker.refresh(queueEmail, currentEpoch);
      const ctx = await sessionContext(toolName, queueEmail, tracker);
      if (ctx) result.text += ctx;
    }
    return result;
  }

  const handler = domainHandlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const email = typeof params.email === 'string' ? params.email : undefined;

  if (email) {
    await tracker.ensureBaseline(email, currentEpoch);
  }

  const result = await handler(params);

  if (email) {
    tracker.refresh(email, currentEpoch);
    const ctx = await sessionContext(toolName, email, tracker);
    if (ctx) result.text += ctx;
  }

  return result;
}

/** Extract email from the first queue operation that has one. */
function extractEmailFromQueue(params: Record<string, unknown>): string | undefined {
  const operations = params.operations as Array<{ args?: Record<string, unknown> }> | undefined;
  if (!Array.isArray(operations)) return undefined;
  for (const op of operations) {
    if (typeof op.args?.email === 'string') return op.args.email;
  }
  return undefined;
}
