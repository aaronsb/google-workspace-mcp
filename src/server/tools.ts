/**
 * Semantic tool registry — operation-based tools with conditional properties.
 *
 * Pattern: fewer tools, more properties. Each tool accepts an `operation`
 * enum that determines behavior and which fields are required.
 */

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const toolSchemas: ToolSchema[] = [
  {
    name: 'manage_accounts',
    description: 'List, authenticate, or remove Google Workspace accounts. Start here to see which accounts are available.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'authenticate', 'remove'],
          description: 'list: show all accounts | authenticate: add new account (opens browser) | remove: delete account and credentials',
        },
        email: { type: 'string', description: 'Required for remove' },
        category: { type: 'string', enum: ['personal', 'work', 'other'], description: 'For authenticate (default: personal)' },
        description: { type: 'string', description: 'For authenticate — optional label' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_email',
    description: 'Search, read, send, or triage emails in a Google Workspace account. Supports Gmail search syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['search', 'read', 'send', 'reply', 'triage'],
          description: 'search: find emails by query | read: get email by ID | send: compose new email | reply: reply to a thread | triage: inbox summary',
        },
        email: { type: 'string', description: 'Account email address' },
        // search
        query: { type: 'string', description: 'Gmail search query (e.g. "from:alice subject:meeting has:attachment")' },
        maxResults: { type: 'number', description: 'Max results for search (default: 10, max: 50)' },
        // read
        messageId: { type: 'string', description: 'Email message ID (for read/reply)' },
        // send/reply
        to: { type: 'string', description: 'Recipient email (for send)' },
        subject: { type: 'string', description: 'Email subject (for send)' },
        body: { type: 'string', description: 'Email body text (for send/reply)' },
      },
      required: ['operation', 'email'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_calendar',
    description: 'List events, view today\'s agenda, or create/update/delete calendar events.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'agenda', 'create', 'get', 'delete'],
          description: 'list: upcoming events | agenda: today at a glance | create: new event | get: event details | delete: remove event',
        },
        email: { type: 'string', description: 'Account email address' },
        // list
        timeMin: { type: 'string', description: 'Start of range (ISO 8601) — defaults to today' },
        timeMax: { type: 'string', description: 'End of range (ISO 8601)' },
        maxResults: { type: 'number', description: 'Max events (default: 10, max: 50)' },
        // get/delete
        eventId: { type: 'string', description: 'Event ID (for get/delete)' },
        // create
        summary: { type: 'string', description: 'Event title (for create)' },
        start: { type: 'string', description: 'Start time ISO 8601 (for create)' },
        end: { type: 'string', description: 'End time ISO 8601 (for create)' },
        description: { type: 'string', description: 'Event description' },
        location: { type: 'string', description: 'Event location' },
        attendees: { type: 'string', description: 'Comma-separated attendee emails' },
      },
      required: ['operation', 'email'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_drive',
    description: 'Search, upload, download, or read files in Google Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['search', 'upload', 'get', 'download'],
          description: 'search: find files | upload: upload local file | get: file metadata | download: download file content',
        },
        email: { type: 'string', description: 'Account email address' },
        // search
        query: { type: 'string', description: 'Drive search query' },
        maxResults: { type: 'number', description: 'Max results (default: 10, max: 50)' },
        // get/download
        fileId: { type: 'string', description: 'File ID (for get/download)' },
        // upload
        filePath: { type: 'string', description: 'Local file path (for upload)' },
        name: { type: 'string', description: 'File name in Drive (for upload, defaults to local name)' },
        parentFolderId: { type: 'string', description: 'Parent folder ID (for upload)' },
        // download
        outputPath: { type: 'string', description: 'Local path to save downloaded file' },
      },
      required: ['operation', 'email'],
      additionalProperties: false,
    },
  },
  {
    name: 'queue_operations',
    description: 'Execute multiple operations in sequence. Operations run in order with result references ($0.field) to chain outputs. Use for multi-step workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: {
                type: 'string',
                enum: ['manage_email', 'manage_calendar', 'manage_drive', 'manage_accounts'],
                description: 'Tool to call',
              },
              args: {
                type: 'object',
                description: 'Arguments for the tool. Use $N.field to reference results from earlier operations.',
              },
              onError: {
                type: 'string',
                enum: ['bail', 'continue'],
                description: 'bail: stop on error (default) | continue: skip and proceed',
              },
            },
            required: ['tool', 'args'],
          },
          maxItems: 10,
          description: 'Operations to execute sequentially',
        },
        detail: {
          type: 'string',
          enum: ['summary', 'full'],
          description: 'summary: one-line status per operation (default) | full: include complete output from each operation',
        },
      },
      required: ['operations'],
      additionalProperties: false,
    },
  },
];

export function getToolSchema(name: string): ToolSchema | undefined {
  return toolSchemas.find(t => t.name === name);
}
