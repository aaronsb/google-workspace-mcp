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

export function clamp(value: unknown, defaultVal: number, max: number): number {
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return Math.min(defaultVal, max);
  return Math.min(n, max);
}
