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
      { description: 'Import into scratchpad for editing', tool: 'manage_scratchpad', example: { operation: 'import', source: 'email', sourceParams: { email: '<email>', messageId: '<messageId>' } } },
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
  meet: {
    listConferences: [
      { description: 'Get conference details', tool: 'manage_meet', example: { operation: 'getConference', email: '<email>', conferenceId: '<conferenceId>' } },
      { description: 'See who attended', tool: 'manage_meet', example: { operation: 'listParticipants', email: '<email>', conferenceId: '<conferenceId>' } },
      { description: 'Get full transcript', tool: 'manage_meet', example: { operation: 'getFullTranscript', email: '<email>', conferenceId: '<conferenceId>' } },
    ],
    getConference: [
      { description: 'See who attended', tool: 'manage_meet', example: { operation: 'listParticipants', email: '<email>', conferenceId: '<conferenceId>' } },
      { description: 'Get full transcript', tool: 'manage_meet', example: { operation: 'getFullTranscript', email: '<email>', conferenceId: '<conferenceId>' } },
      { description: 'List recordings', tool: 'manage_meet', example: { operation: 'listRecordings', email: '<email>', conferenceId: '<conferenceId>' } },
    ],
    listParticipants: [
      { description: 'Get full transcript', tool: 'manage_meet', example: { operation: 'getFullTranscript', email: '<email>', conferenceId: '<conferenceId>' } },
      { description: 'List recent conferences', tool: 'manage_meet', example: { operation: 'listConferences', email: '<email>' } },
    ],
    getFullTranscript: [
      { description: 'List recordings', tool: 'manage_meet', example: { operation: 'listRecordings', email: '<email>', conferenceId: '<conferenceId>' } },
      { description: 'Check smart notes', tool: 'manage_meet', example: { operation: 'listSmartNotes', email: '<email>', conferenceId: '<conferenceId>' } },
    ],
    listTranscripts: [
      { description: 'Read transcript entries', tool: 'manage_meet', example: { operation: 'listTranscriptEntries', email: '<email>', transcriptName: '<transcriptName>' } },
      { description: 'Get full transcript (easier)', tool: 'manage_meet', example: { operation: 'getFullTranscript', email: '<email>', conferenceId: '<conferenceId>' } },
    ],
    listRecordings: [
      { description: 'Get recording details', tool: 'manage_meet', example: { operation: 'getRecording', email: '<email>', recordingName: '<recordingName>' } },
    ],
    listSmartNotes: [
      { description: 'Get smart note details', tool: 'manage_meet', example: { operation: 'getSmartNote', email: '<email>', smartNoteName: '<smartNoteName>' } },
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
  sheets: {
    create: [
      { description: 'Write values', tool: 'manage_sheets', example: { operation: 'updateValues', email: '<email>', spreadsheetId: '<spreadsheetId>', range: 'Sheet1!A1', jsonValues: '[["header1","header2"]]' } },
      { description: 'Append rows', tool: 'manage_sheets', example: { operation: 'append', email: '<email>', spreadsheetId: '<spreadsheetId>', jsonValues: '[["a","b"]]' } },
    ],
    get: [
      { description: 'Read a range', tool: 'manage_sheets', example: { operation: 'read', email: '<email>', spreadsheetId: '<spreadsheetId>', range: '<Sheet1!A1:Z>' } },
      { description: 'Append rows', tool: 'manage_sheets', example: { operation: 'append', email: '<email>', spreadsheetId: '<spreadsheetId>', jsonValues: '[["a","b"]]' } },
    ],
    read: [
      { description: 'Write values to a range', tool: 'manage_sheets', example: { operation: 'updateValues', email: '<email>', spreadsheetId: '<spreadsheetId>', range: '<range>', jsonValues: '[["a","b"]]' } },
      { description: 'Append more rows', tool: 'manage_sheets', example: { operation: 'append', email: '<email>', spreadsheetId: '<spreadsheetId>', jsonValues: '[["a","b"]]' } },
    ],
    getValues: [
      { description: 'Write values to a range', tool: 'manage_sheets', example: { operation: 'updateValues', email: '<email>', spreadsheetId: '<spreadsheetId>', range: '<range>', jsonValues: '[["a","b"]]' } },
    ],
    append: [
      { description: 'Read back what was written', tool: 'manage_sheets', example: { operation: 'read', email: '<email>', spreadsheetId: '<spreadsheetId>', range: '<Sheet1!A1:Z>' } },
    ],
    updateValues: [
      { description: 'Read back what was written', tool: 'manage_sheets', example: { operation: 'read', email: '<email>', spreadsheetId: '<spreadsheetId>', range: '<range>' } },
    ],
  },
  scratchpad: {
    create: [
      { description: 'Add content', tool: 'manage_scratchpad', example: { operation: 'append_lines', scratchpadId: '<scratchpadId>', content: '<text>' } },
      { description: 'Import from a document', tool: 'manage_scratchpad', example: { operation: 'import', scratchpadId: '<scratchpadId>', source: 'doc', sourceParams: { email: '<email>', documentId: '<documentId>' } } },
    ],
    append_lines: [
      { description: 'View buffer', tool: 'manage_scratchpad', example: { operation: 'view', scratchpadId: '<scratchpadId>' } },
      { description: 'Send as email', tool: 'manage_scratchpad', example: { operation: 'send', scratchpadId: '<scratchpadId>', target: 'email', targetParams: { email: '<email>', to: '<recipient>', subject: '<subject>' } } },
    ],
    send: [
      { description: 'Send to another target', tool: 'manage_scratchpad', example: { operation: 'send', scratchpadId: '<scratchpadId>', target: 'workspace', targetParams: { filename: '<name>.md' } } },
      { description: 'Discard scratchpad', tool: 'manage_scratchpad', example: { operation: 'discard', scratchpadId: '<scratchpadId>' } },
    ],
    import: [
      { description: 'View imported content', tool: 'manage_scratchpad', example: { operation: 'view', scratchpadId: '<scratchpadId>' } },
      { description: 'Edit content', tool: 'manage_scratchpad', example: { operation: 'replace_lines', scratchpadId: '<scratchpadId>', startLine: 1, endLine: 1, content: '<new text>' } },
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
