/**
 * Queue handler — execute multiple operations sequentially with
 * result references ($N.field) for chaining outputs.
 *
 * Handlers return { text, refs }. Queue uses refs for $N.field
 * resolution and text for the final response.
 */

import type { HandlerResponse } from './handler.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<HandlerResponse>;

interface QueueOperation {
  tool: string;
  args: Record<string, unknown>;
  onError?: 'bail' | 'continue';
}

interface OperationResult {
  index: number;
  tool: string;
  status: 'success' | 'error' | 'skipped';
  text?: string;
  refs?: Record<string, unknown>;
  error?: string;
}

const NEXT_STEPS_SEPARATOR = '\n\n---\n**Next steps:**';

function stripNextSteps(text: string): string {
  const idx = text.indexOf(NEXT_STEPS_SEPARATOR);
  return idx >= 0 ? text.slice(0, idx) : text;
}

export async function handleQueue(
  params: Record<string, unknown>,
  handlers: Record<string, ToolHandler>,
): Promise<HandlerResponse> {
  const operations = params.operations as QueueOperation[];
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('operations array is required and must not be empty');
  }

  const results: OperationResult[] = [];
  let bailedAt = -1;
  let lastSuccessText = '';

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const errorStrategy = op.onError ?? 'bail';

    if (bailedAt >= 0) {
      results.push({ index: i, tool: op.tool, status: 'skipped' });
      continue;
    }

    const handler = handlers[op.tool];
    if (!handler) {
      results.push({ index: i, tool: op.tool, status: 'error', error: `Unknown tool: ${op.tool}` });
      if (errorStrategy === 'bail') bailedAt = i;
      continue;
    }

    // Resolve $N.field references
    let resolvedArgs: Record<string, unknown>;
    try {
      resolvedArgs = resolveReferences(op.args, results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ index: i, tool: op.tool, status: 'error', error: msg });
      if (errorStrategy === 'bail') bailedAt = i;
      continue;
    }

    try {
      const response = await handler(resolvedArgs);
      const text = stripNextSteps(response.text);
      results.push({ index: i, tool: op.tool, status: 'success', text, refs: response.refs });
      lastSuccessText = response.text; // keep next-steps from last success
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ index: i, tool: op.tool, status: 'error', error: msg });
      if (errorStrategy === 'bail') bailedAt = i;
    }
  }

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  // Build summary markdown
  const lines: string[] = [
    `## Queue Results (${succeeded}/${results.length} succeeded)`,
    '',
  ];

  for (const r of results) {
    const icon = r.status === 'success' ? '✓' : r.status === 'error' ? '✗' : '○';
    const summary = r.status === 'error' ? r.error
                  : r.text ? firstLine(r.text)
                  : r.status;
    lines.push(`${icon} ${r.tool} — ${summary}`);
  }

  // Append consolidated next-steps from last successful operation
  const nextStepsSuffix = extractNextSteps(lastSuccessText);
  const text = lines.join('\n') + nextStepsSuffix;

  // Queue-level refs are aggregate counters only.
  // Per-operation refs are available during execution for $N.field resolution
  // but not exposed in the final response. Exposing them (e.g. as results[N].refs)
  // is scoped for the queue-enhancement workstream.
  const refs: Record<string, unknown> = {
    total: results.length,
    succeeded,
    failed,
    skipped,
  };

  return { text, refs };
}

// --- Reference resolution ---

function resolveReferences(
  args: Record<string, unknown>,
  results: OperationResult[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && /\$\d+\./.test(value)) {
      resolved[key] = resolveRef(value, results);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function resolveRef(value: string, results: OperationResult[]): string {
  return value.replace(/\$(\d+)\.(\w+)/g, (_match, indexStr, field) => {
    const index = parseInt(indexStr, 10);
    if (index >= results.length) {
      throw new Error(`$${index}.${field}: operation ${index} hasn't run yet`);
    }
    const result = results[index];
    if (result.status !== 'success') {
      throw new Error(`$${index}.${field}: operation ${index} ${result.status}`);
    }
    const extracted = result.refs?.[field];
    if (extracted === undefined) {
      throw new Error(`$${index}.${field}: field '${field}' not found in result`);
    }
    return String(extracted);
  });
}

function firstLine(text: string): string {
  // Skip markdown headings to get the first content line
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
      return trimmed.length > 80 ? trimmed.slice(0, 79) + '…' : trimmed;
    }
  }
  return text.split('\n')[0] ?? '';
}

function extractNextSteps(text: string): string {
  const idx = text.indexOf(NEXT_STEPS_SEPARATOR);
  return idx >= 0 ? text.slice(idx) : '';
}
