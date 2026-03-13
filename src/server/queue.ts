/**
 * Queue handler — execute multiple operations sequentially with
 * result references ($N.field) for chaining outputs.
 */

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

interface QueueOperation {
  tool: string;
  args: Record<string, unknown>;
  onError?: 'bail' | 'continue';
}

interface OperationResult {
  index: number;
  tool: string;
  status: 'success' | 'error' | 'skipped';
  data?: unknown;
  error?: string;
}

export async function handleQueue(
  params: Record<string, unknown>,
  handlers: Record<string, ToolHandler>,
): Promise<unknown> {
  const operations = params.operations as QueueOperation[];
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('operations array is required and must not be empty');
  }

  const results: OperationResult[] = [];
  let bailedAt = -1;

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
      const data = await handler(resolvedArgs);
      results.push({ index: i, tool: op.tool, status: 'success', data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ index: i, tool: op.tool, status: 'error', error: msg });
      if (errorStrategy === 'bail') bailedAt = i;
    }
  }

  const succeeded = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  return {
    summary: { total: results.length, succeeded, failed, skipped },
    results,
  };
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
    const extracted = extractField(result.data, field);
    if (extracted === undefined) {
      throw new Error(`$${index}.${field}: field '${field}' not found in result`);
    }
    return String(extracted);
  });
}

function extractField(data: unknown, field: string): unknown {
  if (data == null || typeof data !== 'object') return undefined;
  const obj = data as Record<string, unknown>;

  // Direct field lookup
  if (field in obj) return obj[field];

  // Common nested patterns
  if (field === 'id' && 'emails' in obj) {
    const emails = obj.emails as Array<Record<string, unknown>>;
    return emails[0]?.id;
  }
  if (field === 'id' && 'events' in obj) {
    const events = obj.events as Array<Record<string, unknown>>;
    return events[0]?.id;
  }
  if (field === 'id' && 'files' in obj) {
    const files = obj.files as Array<Record<string, unknown>>;
    return files[0]?.id;
  }

  return undefined;
}
