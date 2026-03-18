/**
 * Contextual next-steps guidance. Appended as a markdown footer to every
 * response so agents discover natural follow-on actions.
 */

interface NextStep {
  description: string;
  tool: string;
  example: Record<string, unknown>;
}

const suggestions: Record<string, Record<string, NextStep[]>> = {
  accounts: {
    list_empty: [
      { description: 'Add an account', tool: 'manage_accounts', example: { operation: 'authenticate' } },
    ],
    list: [
      { description: 'Check inbox', tool: 'manage_email', example: { operation: 'triage', email: '<account email>' } },
      { description: 'View today\'s schedule', tool: 'manage_calendar', example: { operation: 'agenda', email: '<account email>' } },
      { description: 'Search files', tool: 'manage_drive', example: { operation: 'search', email: '<account email>' } },
    ],
    authenticate: [
      { description: 'List accounts to verify', tool: 'manage_accounts', example: { operation: 'list' } },
      { description: 'Check account status', tool: 'manage_accounts', example: { operation: 'status', email: '<email>' } },
    ],
    remove: [
      { description: 'List remaining accounts', tool: 'manage_accounts', example: { operation: 'list' } },
    ],
    status: [
      { description: 'Refresh credentials', tool: 'manage_accounts', example: { operation: 'refresh', email: '<email>' } },
      { description: 'Update scopes', tool: 'manage_accounts', example: { operation: 'scopes', email: '<email>', services: 'gmail,drive,calendar' } },
    ],
    refresh: [
      { description: 'Verify token is valid', tool: 'manage_accounts', example: { operation: 'status', email: '<email>' } },
    ],
    scopes: [
      { description: 'Verify new scopes', tool: 'manage_accounts', example: { operation: 'status', email: '<email>' } },
    ],
    // Auth error guidance — used by server.ts when GwsError has exit code 2
    auth_error: [
      { description: 'Re-authenticate account', tool: 'manage_accounts', example: { operation: 'authenticate' } },
      { description: 'Check account status', tool: 'manage_accounts', example: { operation: 'status', email: '<email>' } },
    ],
  },
  email: {
    search: [
      { description: 'Read a specific email', tool: 'manage_email', example: { operation: 'read', email: '<email>', messageId: '<id from results>' } },
      { description: 'Narrow search', tool: 'manage_email', example: { operation: 'search', email: '<email>', query: '<refined query>' } },
    ],
    read: [
      { description: 'Reply to this email', tool: 'manage_email', example: { operation: 'reply', email: '<email>', messageId: '<messageId>', body: '<reply text>' } },
      { description: 'Search for related emails', tool: 'manage_email', example: { operation: 'search', email: '<email>', query: 'thread:<threadId>' } },
    ],
    send: [
      { description: 'Check inbox for replies', tool: 'manage_email', example: { operation: 'triage', email: '<email>' } },
    ],
    reply: [
      { description: 'Check inbox', tool: 'manage_email', example: { operation: 'triage', email: '<email>' } },
    ],
    triage: [
      { description: 'Read a specific email', tool: 'manage_email', example: { operation: 'read', email: '<email>', messageId: '<id from results>' } },
      { description: 'Search for specific emails', tool: 'manage_email', example: { operation: 'search', email: '<email>', query: '<query>' } },
    ],
  },
  calendar: {
    list: [
      { description: 'Get event details', tool: 'manage_calendar', example: { operation: 'get', email: '<email>', eventId: '<id from results>' } },
      { description: 'Create a new event', tool: 'manage_calendar', example: { operation: 'create', email: '<email>', summary: '<title>', start: '<ISO>', end: '<ISO>' } },
    ],
    agenda: [
      { description: 'Get event details', tool: 'manage_calendar', example: { operation: 'get', email: '<email>', eventId: '<id>' } },
      { description: 'Create a new event', tool: 'manage_calendar', example: { operation: 'create', email: '<email>', summary: '<title>', start: '<ISO>', end: '<ISO>' } },
    ],
    create: [
      { description: 'View updated schedule', tool: 'manage_calendar', example: { operation: 'list', email: '<email>' } },
    ],
    get: [
      { description: 'Delete this event', tool: 'manage_calendar', example: { operation: 'delete', email: '<email>', eventId: '<eventId>' } },
    ],
    delete: [
      { description: 'View updated schedule', tool: 'manage_calendar', example: { operation: 'list', email: '<email>' } },
    ],
  },
  drive: {
    search: [
      { description: 'Get file details', tool: 'manage_drive', example: { operation: 'get', email: '<email>', fileId: '<id from results>' } },
      { description: 'Download a file', tool: 'manage_drive', example: { operation: 'download', email: '<email>', fileId: '<id>' } },
    ],
    get: [
      { description: 'Download this file', tool: 'manage_drive', example: { operation: 'download', email: '<email>', fileId: '<fileId>' } },
    ],
    upload: [
      { description: 'Search to verify upload', tool: 'manage_drive', example: { operation: 'search', email: '<email>', query: 'name contains \'<filename>\'' } },
    ],
    download: [
      { description: 'Search for more files', tool: 'manage_drive', example: { operation: 'search', email: '<email>' } },
    ],
  },
};

/**
 * Returns a markdown footer string with contextual next-steps guidance.
 * Returns empty string when no suggestions exist for the domain/operation.
 */
export function nextSteps(
  domain: string,
  operation: string,
  context?: Record<string, string>,
): string {
  const steps = suggestions[domain]?.[operation] ?? [];
  if (steps.length === 0) return '';

  const resolved = context
    ? steps.map(step => ({ ...step, example: replacePlaceholders(step.example, context) }))
    : steps;

  const lines = resolved.map(step =>
    `- ${step.description}: \`${step.tool}\` — \`${JSON.stringify(step.example)}\``
  );

  return `\n\n---\n**Next steps:**\n${lines.join('\n')}`;
}

function replacePlaceholders(
  obj: Record<string, unknown>,
  context: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      let replaced = value;
      for (const [cKey, cVal] of Object.entries(context)) {
        replaced = replaced.replace(`<${cKey}>`, cVal);
      }
      result[key] = replaced;
    } else {
      result[key] = value;
    }
  }
  return result;
}
