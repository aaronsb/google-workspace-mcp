/**
 * The preview gate for standing-effect writes (ADR-309).
 *
 * A preview mints a token over the exact payload it evaluated; the write refuses without
 * one. The token is an HMAC under a key made at process start, so nothing is stored and
 * nothing needs cleaning up. A restart invalidates every outstanding token, and the remedy
 * is to preview again.
 *
 * A token proves the evaluation was returned to the caller. It does not prove a person
 * read it; that is the MCP client's per-call permission prompt.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { currentCallId } from './call-context.js';

const KEY = randomBytes(32);

/** How long a preview stays good. Match counts and conflicts drift as mail arrives. */
export const PREVIEW_TTL_MS = 30 * 60_000;

/** Tolerated clock skew for a token that claims to come from the future. */
const SKEW_MS = 60_000;

interface TokenHeader {
  /** What the token authorizes, e.g. `gmail.filter.create`. */
  k: string;
  /** Issued at, epoch ms. */
  t: number;
  /** The top-level tool call that minted it. */
  c: number;
}

export type TokenFailure = 'missing' | 'malformed' | 'wrong-kind' | 'mismatch' | 'expired' | 'same-call';

export type TokenCheck =
  | { ok: true }
  | { ok: false; failure: TokenFailure; issuedFor?: string };

/** JSON with object keys sorted at every depth, so equal payloads serialize equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mac(headerPart: string, account: string, payload: unknown): Buffer {
  return createHmac('sha256', KEY)
    .update(headerPart).update('\n')
    .update(account.toLowerCase()).update('\n')
    .update(canonicalJson(payload))
    .digest();
}

/** Mint a token for `kind`, bound to this account, this payload, now, and this call. */
export function mintPreviewToken(kind: string, account: string, payload: unknown, now = Date.now()): string {
  const header: TokenHeader = { k: kind, t: now, c: currentCallId() };
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url');
  return `${headerPart}.${mac(headerPart, account, payload).toString('base64url')}`;
}

/** Check a token against the write about to happen. */
export function checkPreviewToken(
  token: unknown,
  kind: string,
  account: string,
  payload: unknown,
  now = Date.now(),
): TokenCheck {
  if (typeof token !== 'string' || token.trim() === '') return { ok: false, failure: 'missing' };

  const [headerPart, macPart, extra] = token.trim().split('.');
  if (!headerPart || !macPart || extra !== undefined) return { ok: false, failure: 'malformed' };

  let header: TokenHeader;
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf-8')) as TokenHeader;
  } catch {
    return { ok: false, failure: 'malformed' };
  }
  if (typeof header?.k !== 'string' || typeof header.t !== 'number' || typeof header.c !== 'number') {
    return { ok: false, failure: 'malformed' };
  }

  // The header is readable by anyone, so nothing in it counts until the MAC agrees. The
  // kind check reports a token meant for a sibling operation, which is a useful thing to
  // say, but only once the token is known to be genuine.
  const expected = mac(headerPart, account, payload);
  const given = Buffer.from(macPart, 'base64url');
  const genuine = given.length === expected.length && timingSafeEqual(given, expected);
  if (!genuine) return { ok: false, failure: 'mismatch' };
  if (header.k !== kind) return { ok: false, failure: 'wrong-kind', issuedFor: header.k };
  if (header.t > now + SKEW_MS || now - header.t > PREVIEW_TTL_MS) return { ok: false, failure: 'expired' };
  if (header.c !== 0 && header.c === currentCallId()) return { ok: false, failure: 'same-call' };
  return { ok: true };
}

/**
 * The sentence a refused write returns.
 *
 * @param write The operation refused, e.g. `createFilter`.
 * @param preview The operation that mints its token, e.g. `previewFilter`.
 */
export function describeTokenFailure(check: Extract<TokenCheck, { ok: false }>, write: string, preview: string): string {
  const again = `Call \`${preview}\` with these exact parameters and pass the previewToken it returns.`;
  switch (check.failure) {
    case 'missing':
      return `\`${write}\` needs a previewToken. It changes what happens to mail that has not arrived yet, ` +
        `so it runs only after a preview of this exact change has been returned. ${again}`;
    case 'malformed':
      return `The previewToken is not one this server issued. ${again}`;
    case 'wrong-kind':
      return `This previewToken was issued for a different operation (${check.issuedFor ?? 'unknown'}), not \`${write}\`. ${again}`;
    case 'mismatch':
      return `This previewToken does not match this change on this account. Either a parameter changed since ` +
        `the preview, the token came from another account, or the server restarted. ${again}`;
    case 'expired':
      return `This previewToken has expired; previews are good for ${PREVIEW_TTL_MS / 60_000} minutes because ` +
        `what they match changes as mail arrives. ${again}`;
    case 'same-call':
      return `This previewToken was minted earlier in this same tool call, so the preview was never returned ` +
        `before \`${write}\` ran. Run the preview as its own call, read it, then call \`${write}\`.`;
  }
}
