import { BULK_TOOL_NAMES } from '../tool-names.js';

const BULK_TOOLS = new Set(BULK_TOOL_NAMES);
const INBOX_UNREAD_LABELS = new Set(['INBOX', 'UNREAD']);

function changesInboxUnread(tool: string, params: Record<string, unknown>): boolean {
  if (tool === 'manage_email') {
    const operation = params.operation;
    if (operation === 'trash' || operation === 'untrash') return true;
    // Filters route future mail; their preview's match count is not a backlog write.
    if (operation !== 'modify' && operation !== 'modifyMatching') return false;
    return changesRelevantLabels(params);
  }

  if (!BULK_TOOLS.has(tool)) return false;
  if (params.mode === 'batch') {
    const operation = params.operation;
    if (params.tool !== 'manage_email') return false;
    if (operation === 'trash') return true;
    return operation === 'modify' && changesRelevantLabels(params);
  }

  const operations = params.operations;
  return Array.isArray(operations) && operations.some((op) => {
    if (!op || typeof op !== 'object') return false;
    const queued = op as { tool?: unknown; args?: unknown };
    return typeof queued.tool === 'string'
      && queued.args !== null
      && typeof queued.args === 'object'
      && changesInboxUnread(queued.tool, queued.args as Record<string, unknown>);
  });
}

function changesRelevantLabels(params: Record<string, unknown>): boolean {
  return [params.addLabelIds, params.removeLabelIds].some((value) => {
    const ids = typeof value === 'string'
      ? value.split(',')
      : Array.isArray(value) ? value : [];
    return ids.some((id) => typeof id === 'string' && INBOX_UNREAD_LABELS.has(id.trim()));
  });
}

/** Accounts whose current inbox-unread count may change during this tool call. */
export function inboxUnreadMutationAccounts(
  tool: string,
  params: Record<string, unknown>,
): string[] {
  const accounts = new Set<string>();

  const visit = (currentTool: string, args: Record<string, unknown>): void => {
    if (currentTool === 'manage_email' && changesInboxUnread(currentTool, args)) {
      if (typeof args.email === 'string' && args.email) accounts.add(args.email);
      return;
    }

    if (!BULK_TOOLS.has(currentTool)) return;
    if (args.mode === 'batch') {
      if (changesInboxUnread(currentTool, args) && typeof args.email === 'string' && args.email) {
        accounts.add(args.email);
      }
      return;
    }

    if (!Array.isArray(args.operations)) return;
    for (const op of args.operations) {
      if (!op || typeof op !== 'object') continue;
      const queued = op as { tool?: unknown; args?: unknown };
      if (typeof queued.tool !== 'string' || !queued.args || typeof queued.args !== 'object') continue;
      visit(queued.tool, queued.args as Record<string, unknown>);
    }
  };

  visit(tool, params);
  return [...accounts];
}
