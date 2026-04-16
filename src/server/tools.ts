/**
 * Tool registry — combines factory-generated schemas with hand-coded tools.
 *
 * Factory tools come from the manifest (ADR-300). Hand-coded tools are
 * manage_accounts (not a gws wrapper) and queue_operations (meta-tool).
 */

import { generatedTools } from '../factory/registry.js';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Hand-coded tools that don't go through the factory
const handCodedSchemas: ToolSchema[] = [
  {
    name: 'manage_accounts',
    description: 'Manage Google Workspace account lifecycle: list, authenticate, check status, refresh credentials, update scopes, or remove accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'authenticate', 'remove', 'status', 'refresh', 'scopes', 'capabilities'],
          description: 'list: show all accounts | authenticate: add new account (opens browser) | remove: delete account and credentials | status: check token validity and scopes | refresh: re-export credentials from gws | scopes: re-auth with different services | capabilities: show available services, safety policies, and workspace status',
        },
        email: { type: 'string', description: 'Required for remove, status, refresh, scopes' },
        category: { type: 'string', enum: ['personal', 'work', 'other'], description: 'For authenticate (default: personal)' },
        description: { type: 'string', description: 'For authenticate — optional label' },
        services: { type: 'string', description: 'For scopes — comma-separated service names (e.g. gmail,drive,calendar,sheets)' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_workspace',
    description: 'Manage files and directories in the workspace sandbox. Supports nested paths (e.g. "reports/q1/summary.csv"). The workspace is the exchange point for file operations (attachments, downloads, exports).',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'read', 'write', 'delete', 'move', 'mkdir', 'compress', 'decompress'],
          description: 'list: show files (recursive) | read: get file content | write: save content to file | delete: remove file or directory | move: move or rename a file/directory | mkdir: create a directory | compress: gzip a file | decompress: gunzip a file',
        },
        filename: { type: 'string', description: 'File path, may include directories (for read, write, delete, compress, decompress). E.g. "reports/q1/summary.csv"' },
        content: { type: 'string', description: 'File content to write (for write)' },
        path: { type: 'string', description: 'Directory path (for list: scope to subdirectory, for mkdir: directory to create)' },
        source: { type: 'string', description: 'Source path (for move)' },
        destination: { type: 'string', description: 'Destination path (for move, compress, decompress). Defaults to filename.gz for compress, strips .gz for decompress.' },
      },
      required: ['operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'manage_scratchpad',
    description: 'Compose, edit, and deliver text content. Use for any multi-line content: emails, documents, descriptions. Compose in the scratchpad, edit by line or JSON path, attach files, then send to any target. For short one-liners, use the service tool directly instead.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'create', 'view', 'discard', 'list',
            'insert_lines', 'append_lines', 'replace_lines', 'remove_lines', 'copy_lines',
            'json_get', 'json_set', 'json_delete', 'json_insert',
            'attach', 'detach',
            'import', 'send',
          ],
          description: 'create: new buffer | view: show content | discard: free buffer | list: show all | insert_lines/append_lines/replace_lines/remove_lines: line editing | copy_lines: copy from another scratchpad | json_get/json_set/json_delete/json_insert: path-addressed JSON editing | attach/detach: file references | import: load from GWS resource | send: deliver to target',
        },
        scratchpadId: { type: 'string', description: 'Scratchpad ID (sp-XXXX). Required for all operations except create and list.' },
        // create
        label: { type: 'string', description: 'For create: optional human-readable label' },
        format: { type: 'string', enum: ['text', 'markdown', 'json', 'csv'], description: 'For create: content format (default: text). Controls validation and addressing mode.' },
        // line ops
        content: { type: 'string', description: 'Text content. For create (pre-fill), insert_lines, append_lines, replace_lines.' },
        afterLine: { type: 'number', description: 'Insert after this line number (0 = prepend). For insert_lines, copy_lines, attach.' },
        startLine: { type: 'number', description: 'Start of line range (1-based). For replace_lines, remove_lines, copy_lines, view.' },
        endLine: { type: 'number', description: 'End of line range (inclusive). For replace_lines, remove_lines, copy_lines, view.' },
        // copy_lines
        fromScratchpadId: { type: 'string', description: 'For copy_lines: source scratchpad ID' },
        // json path ops
        path: { type: 'string', description: 'For json_* ops: JSON path (e.g., $.config.name, $.items[0].value)' },
        value: { description: 'For json_set, json_insert: value to set or insert (any JSON type)' },
        // attach
        source: { type: 'string', description: 'For attach: file source (workspace or drive). For import: resource type (doc, email, sheet, drive_file).' },
        filename: { type: 'string', description: 'For attach (workspace source): filename in workspace' },
        fileId: { type: 'string', description: 'For attach (drive source): Drive file ID' },
        refId: { type: 'string', description: 'For detach: attachment reference ID (att-1, att-2, etc.)' },
        // import
        sourceParams: { type: 'object', description: 'For import: source-specific parameters (e.g., { documentId, mode } for doc, { messageId } for email)' },
        // send
        target: { type: 'string', enum: ['email', 'email_draft', 'doc_create', 'doc_write', 'workspace', 'sheet_write', 'calendar_event', 'task_create'], description: 'For send: delivery target' },
        targetParams: { type: 'object', description: 'For send: target-specific parameters (e.g., { email, to, subject } for email, { filename } for workspace)' },
        keep: { type: 'boolean', description: 'For send: keep scratchpad after successful send (default: true)' },
      },
      required: ['operation'],
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
                enum: ['manage_email', 'manage_calendar', 'manage_drive', 'manage_sheets', 'manage_docs', 'manage_tasks', 'manage_meet', 'manage_accounts', 'manage_scratchpad', 'manage_workspace'],
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

// Factory-generated schemas from the shared registry
const factorySchemas: ToolSchema[] = generatedTools.map(t => t.schema);

export const toolSchemas: ToolSchema[] = [
  ...handCodedSchemas,
  ...factorySchemas,
];

export function getToolSchema(name: string): ToolSchema | undefined {
  return toolSchemas.find(t => t.name === name);
}
