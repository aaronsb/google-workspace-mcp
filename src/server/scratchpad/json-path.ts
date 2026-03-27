/**
 * JSON path helpers for path-addressed editing.
 * Supports dot/bracket notation: $.foo.bar[0].baz
 */

/** Parse a JSON path into segments. */
export function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  const normalized = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
  if (!normalized) return segments;

  const parts = normalized.split(/\.|\[|\]/).filter(Boolean);
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (!isNaN(num) && String(num) === part) {
      segments.push(num);
    } else {
      segments.push(part);
    }
  }
  return segments;
}

/** Get a value at a JSON path. */
export function getByPath(obj: unknown, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      throw new Error(`Path ${path}: cannot traverse into ${typeof current}`);
    }
    current = (current as Record<string, unknown>)[String(seg)];
  }
  return current;
}

/** Set a value at a JSON path. */
export function setByPath(obj: unknown, path: string, value: unknown): void {
  const segments = parsePath(path);
  if (segments.length === 0) throw new Error('Cannot set at root path');

  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || current === undefined || typeof current !== 'object') {
      throw new Error(`Path ${path}: cannot traverse into ${typeof current} at segment ${segments[i]}`);
    }
    current = (current as Record<string, unknown>)[String(segments[i])];
  }

  if (current === null || current === undefined || typeof current !== 'object') {
    throw new Error(`Path ${path}: parent is not an object`);
  }

  (current as Record<string, unknown>)[String(segments[segments.length - 1])] = value;
}

/** Delete a key or array element at a JSON path. */
export function deleteByPath(obj: unknown, path: string): void {
  const segments = parsePath(path);
  if (segments.length === 0) throw new Error('Cannot delete root');

  let current: unknown = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || current === undefined || typeof current !== 'object') {
      throw new Error(`Path ${path}: cannot traverse into ${typeof current} at segment ${segments[i]}`);
    }
    current = (current as Record<string, unknown>)[String(segments[i])];
  }

  if (current === null || current === undefined || typeof current !== 'object') {
    throw new Error(`Path ${path}: parent is not an object`);
  }

  const lastSeg = segments[segments.length - 1];
  if (Array.isArray(current) && typeof lastSeg === 'number') {
    current.splice(lastSeg, 1);
  } else {
    delete (current as Record<string, unknown>)[String(lastSeg)];
  }
}
