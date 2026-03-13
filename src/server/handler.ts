import { handleAccounts } from './handlers/accounts.js';
import { handleEmail } from './handlers/email.js';
import { handleCalendar } from './handlers/calendar.js';
import { handleDrive } from './handlers/drive.js';
import { handleQueue } from './queue.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

const domainHandlers: Record<string, ToolHandler> = {
  manage_accounts: handleAccounts,
  manage_email: handleEmail,
  manage_calendar: handleCalendar,
  manage_drive: handleDrive,
};

export async function handleToolCall(
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // Queue wraps the domain handlers
  if (toolName === 'queue_operations') {
    return handleQueue(params, domainHandlers);
  }

  const handler = domainHandlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Email validation happens inside each handler via requireEmail()
  return handler(params);
}
