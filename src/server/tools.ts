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
    description: 'Read, write, list, or delete files in the workspace directory. The workspace is the exchange point for file operations (attachments, downloads, exports).',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'read', 'write', 'delete'],
          description: 'list: show files in workspace | read: get file content | write: save content to file | delete: remove a file',
        },
        filename: { type: 'string', description: 'File name (for read, write, delete)' },
        content: { type: 'string', description: 'File content to write (for write)' },
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

// Factory-generated schemas from the shared registry
const factorySchemas: ToolSchema[] = generatedTools.map(t => t.schema);

export const toolSchemas: ToolSchema[] = [
  ...handCodedSchemas,
  ...factorySchemas,
];

export function getToolSchema(name: string): ToolSchema | undefined {
  return toolSchemas.find(t => t.name === name);
}
