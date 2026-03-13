import { GwsError } from '../executor/errors.js';
import { handleAccounts } from './handlers/accounts.js';
import { handleEmail } from './handlers/email.js';
import { handleCalendar } from './handlers/calendar.js';
import { handleDrive } from './handlers/drive.js';
import { handleQueue } from './queue.js';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

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
  // Validate email if present (prevents path traversal in credential routing)
  if (params.email && typeof params.email === 'string') {
    if (!EMAIL_RE.test(params.email)) {
      throw new Error('Invalid email address format');
    }
  }

  // Queue handler wraps the domain handlers
  if (toolName === 'queue_operations') {
    return handleQueue(params, domainHandlers);
  }

  const handler = domainHandlers[toolName];
  if (!handler) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return handler(params);
}
