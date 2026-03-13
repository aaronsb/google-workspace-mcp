/**
 * Semantic tool registry — maps intent-based MCP tools to gws commands.
 *
 * Instead of exposing 200+ raw API methods, we group by user intent.
 * Each tool definition includes: MCP schema, the gws command it maps to,
 * and a function to translate MCP args into gws CLI args.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: 'accounts' | 'email' | 'calendar' | 'drive' | 'docs' | 'sheets';
  requiresAccount: boolean;
  toGwsArgs: (params: Record<string, unknown>) => string[];
}

// --- Account management tools (handled directly, not via gws) ---

const accountTools: ToolDefinition[] = [
  {
    name: 'list_accounts',
    description: 'List all configured Google Workspace accounts and their status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    category: 'accounts',
    requiresAccount: false,
    toGwsArgs: () => [],
  },
  {
    name: 'authenticate_account',
    description: 'Add and authenticate a new Google Workspace account. Opens a browser for OAuth consent.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['personal', 'work', 'other'],
          description: 'Account category (default: personal)',
        },
        description: {
          type: 'string',
          description: 'Optional description for this account',
        },
      },
    },
    category: 'accounts',
    requiresAccount: false,
    toGwsArgs: () => [],
  },
  {
    name: 'remove_account',
    description: 'Remove a Google Workspace account and its stored credentials',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address of the account to remove' },
      },
      required: ['email'],
    },
    category: 'accounts',
    requiresAccount: false,
    toGwsArgs: () => [],
  },
];

// --- Email tools ---

const emailTools: ToolDefinition[] = [
  {
    name: 'search_emails',
    description: 'Search for emails in a Google Workspace account. Supports Gmail search syntax (from:, to:, subject:, has:attachment, etc).',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email to search' },
        query: { type: 'string', description: 'Gmail search query (e.g. "from:alice subject:meeting")' },
        maxResults: { type: 'number', description: 'Maximum results to return (default: 10, max: 50)' },
      },
      required: ['email'],
    },
    category: 'email',
    requiresAccount: true,
    toGwsArgs: (params) => {
      const args = ['gmail', 'users', 'messages', 'list', '--params',
        JSON.stringify({
          userId: 'me',
          q: params.query || '',
          maxResults: Math.min(Number(params.maxResults) || 10, 50),
        }),
      ];
      return args;
    },
  },
  {
    name: 'read_email',
    description: 'Read a specific email by ID. Returns headers, body, and attachment metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email' },
        messageId: { type: 'string', description: 'Email message ID' },
      },
      required: ['email', 'messageId'],
    },
    category: 'email',
    requiresAccount: true,
    toGwsArgs: (params) => [
      'gmail', 'users', 'messages', 'get',
      '--params', JSON.stringify({ userId: 'me', id: params.messageId }),
    ],
  },
  {
    name: 'send_email',
    description: 'Send an email from a Google Workspace account',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email to send from' },
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body text' },
      },
      required: ['email', 'to', 'subject', 'body'],
    },
    category: 'email',
    requiresAccount: true,
    toGwsArgs: (params) => [
      'gmail', '+send',
      '--to', String(params.to),
      '--subject', String(params.subject),
      '--body', String(params.body),
    ],
  },
  {
    name: 'inbox_summary',
    description: 'Get a summary of recent unread emails (sender, subject, date). Quick inbox triage.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email' },
      },
      required: ['email'],
    },
    category: 'email',
    requiresAccount: true,
    toGwsArgs: () => ['gmail', '+triage'],
  },
];

// --- Calendar tools ---

const calendarTools: ToolDefinition[] = [
  {
    name: 'get_calendar_events',
    description: 'List upcoming calendar events. Defaults to today if no time range specified.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email' },
        timeMin: { type: 'string', description: 'Start of time range (ISO 8601)' },
        timeMax: { type: 'string', description: 'End of time range (ISO 8601)' },
        maxResults: { type: 'number', description: 'Maximum events to return (default: 10)' },
      },
      required: ['email'],
    },
    category: 'calendar',
    requiresAccount: true,
    toGwsArgs: (params) => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      return [
        'calendar', 'events', 'list',
        '--params', JSON.stringify({
          calendarId: 'primary',
          timeMin: params.timeMin || todayStart,
          timeMax: params.timeMax || undefined,
          maxResults: Math.min(Number(params.maxResults) || 10, 50),
          singleEvents: true,
          orderBy: 'startTime',
        }),
      ];
    },
  },
  {
    name: 'todays_agenda',
    description: 'Get today\'s meetings and schedule at a glance across all calendars',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email' },
      },
      required: ['email'],
    },
    category: 'calendar',
    requiresAccount: true,
    toGwsArgs: () => ['calendar', '+agenda'],
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new calendar event',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email' },
        summary: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start time (ISO 8601)' },
        end: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description' },
        location: { type: 'string', description: 'Event location' },
        attendees: { type: 'string', description: 'Comma-separated attendee emails' },
      },
      required: ['email', 'summary', 'start', 'end'],
    },
    category: 'calendar',
    requiresAccount: true,
    toGwsArgs: (params) => {
      const args = [
        'calendar', '+insert',
        '--summary', String(params.summary),
        '--start', String(params.start),
        '--end', String(params.end),
      ];
      if (params.description) args.push('--description', String(params.description));
      if (params.location) args.push('--location', String(params.location));
      if (params.attendees) args.push('--attendees', String(params.attendees));
      return args;
    },
  },
];

// --- Drive tools ---

const driveTools: ToolDefinition[] = [
  {
    name: 'search_drive',
    description: 'Search for files in Google Drive. Supports Drive search syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email' },
        query: { type: 'string', description: 'Drive search query (e.g. "name contains \'report\' and mimeType = \'application/pdf\'")' },
        maxResults: { type: 'number', description: 'Maximum results (default: 10)' },
      },
      required: ['email'],
    },
    category: 'drive',
    requiresAccount: true,
    toGwsArgs: (params) => [
      'drive', 'files', 'list',
      '--params', JSON.stringify({
        q: params.query || undefined,
        pageSize: Math.min(Number(params.maxResults) || 10, 50),
        fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink)',
      }),
    ],
  },
  {
    name: 'upload_file',
    description: 'Upload a file to Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Account email' },
        filePath: { type: 'string', description: 'Local path to the file to upload' },
        name: { type: 'string', description: 'Name for the file in Drive (defaults to local filename)' },
        parentFolderId: { type: 'string', description: 'ID of the parent folder in Drive' },
      },
      required: ['email', 'filePath'],
    },
    category: 'drive',
    requiresAccount: true,
    toGwsArgs: (params) => {
      const args = ['drive', '+upload', String(params.filePath)];
      if (params.name) args.push('--name', String(params.name));
      if (params.parentFolderId) args.push('--parent', String(params.parentFolderId));
      return args;
    },
  },
];

// --- All tools ---

export const allTools: ToolDefinition[] = [
  ...accountTools,
  ...emailTools,
  ...calendarTools,
  ...driveTools,
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return allTools.find(t => t.name === name);
}

export function getToolsByCategory(category: ToolDefinition['category']): ToolDefinition[] {
  return allTools.filter(t => t.category === category);
}
