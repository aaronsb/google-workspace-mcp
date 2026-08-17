const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function requireEmail(params: Record<string, unknown>): string {
  const email = params.email;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new Error('A valid email address is required for this operation');
  }
  return email;
}

export function requireString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
  return value;
}

/**
 * A string the caller may omit. An absent field and an empty one are the same
 * request — "I am not narrowing this" — so both come back undefined rather than
 * as `''`, which callers would otherwise have to special-case at every use.
 */
export function optionalString(params: Record<string, unknown>, field: string): string | undefined {
  const value = params[field];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value.trim();
}

export function clamp(value: unknown, defaultVal: number, max: number): number {
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return Math.min(defaultVal, max);
  return Math.min(n, max);
}
