/**
 * Default formatters — generic markdown renderers for list/detail/action
 * responses. Used when a service has no patch formatter override.
 */

import type { HandlerResponse } from '../server/formatting/markdown.js';
import type { OperationDef } from './types.js';

/** Route to the appropriate default formatter based on operation type. */
export function formatDefault(data: unknown, opDef: OperationDef): HandlerResponse {
  switch (opDef.type) {
    case 'list':
      return formatDefaultList(data);
    case 'detail':
      return formatDefaultDetail(data);
    case 'action':
      return formatDefaultAction(data);
    default:
      return formatDefaultDetail(data);
  }
}

/** Generic list formatter — renders array items as pipe-delimited rows. */
function formatDefaultList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  // Try common list wrapper keys
  const items = findArray(raw);

  if (items.length === 0) {
    return { text: 'No results found.', refs: { count: 0 } };
  }

  const lines = items.map(item => {
    const obj = item as Record<string, unknown>;
    const id = String(obj.id ?? '');
    const parts = [id];
    // Include a few meaningful string fields
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'id') continue;
      if (typeof val === 'string' && val.length < 100) {
        parts.push(val);
      }
      if (parts.length >= 5) break;
    }
    return parts.join(' | ');
  });

  return {
    text: `## Results (${items.length})\n\n${lines.join('\n')}`,
    refs: {
      count: items.length,
      id: String((items[0] as Record<string, unknown>)?.id ?? ''),
      ids: items.map(i => String((i as Record<string, unknown>)?.id ?? '')),
    },
  };
}

/** Generic detail formatter — renders object fields as bold key/value pairs. */
function formatDefaultDetail(data: unknown): HandlerResponse {
  const obj = data as Record<string, unknown>;
  const title = String(obj.name ?? obj.summary ?? obj.subject ?? obj.title ?? 'Details');
  const id = String(obj.id ?? '');

  const parts: string[] = [`## ${title}`, ''];
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'object') continue; // skip nested objects
    parts.push(`**${key}:** ${val}`);
  }

  return {
    text: parts.join('\n'),
    refs: { id, ...extractScalarRefs(obj) },
  };
}

/** Generic action formatter — confirmation message with returned fields. */
function formatDefaultAction(data: unknown): HandlerResponse {
  const obj = (data ?? {}) as Record<string, unknown>;
  const id = String(obj.id ?? 'unknown');

  const parts: string[] = ['Operation completed.'];
  if (obj.id) parts.push(`\n**ID:** ${id}`);

  return {
    text: parts.join(''),
    refs: { id, ...extractScalarRefs(obj) },
  };
}

/** Find the first array in a response object (items, files, messages, etc). */
function findArray(obj: Record<string, unknown>): unknown[] {
  if (Array.isArray(obj)) return obj;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) return val;
  }
  return [];
}

/** Pull scalar values from an object for refs. */
function extractScalarRefs(obj: Record<string, unknown>): Record<string, unknown> {
  const refs: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      refs[key] = val;
    }
  }
  return refs;
}
