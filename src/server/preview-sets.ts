/**
 * Sets resolved at preview and held for the write that applies them (ADR-310).
 *
 * A query-scoped bulk write resolves its query once, at preview, so the apply changes
 * exactly what the preview counted. The set is kept here, keyed by the preview token,
 * and the token covers a digest of it, so a set that went missing or changed cannot be
 * applied. Memory is bounded three ways: ids per set, a set's age, and sets per process.
 * A restart drops every set, as it already invalidates every token.
 */

import { createHash } from 'node:crypto';

import { PREVIEW_TTL_MS } from './preview-gate.js';

/** Most ids one preview may hold. A larger result is narrowed by the caller instead. */
export const MAX_SET_SIZE = 10_000;

/** Most previews held at once; the oldest goes first. */
export const MAX_PENDING_SETS = 20;

interface HeldSet {
  account: string;
  ids: string[];
  heldAt: number;
}

const held = new Map<string, HeldSet>();

/** A digest of the set, independent of order, for the token to cover. */
export function setDigest(ids: readonly string[]): string {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('base64url');
}

function dropExpired(now: number): void {
  for (const [key, set] of held) {
    if (now - set.heldAt > PREVIEW_TTL_MS) held.delete(key);
  }
}

/** Hold a set under its preview token. */
export function holdSet(token: string, account: string, ids: readonly string[], now = Date.now()): void {
  if (ids.length > MAX_SET_SIZE) throw new Error(`A previewed set holds at most ${MAX_SET_SIZE} ids, not ${ids.length}.`);
  dropExpired(now);
  held.delete(token);
  while (held.size >= MAX_PENDING_SETS) {
    // Map iterates in insertion order, so the first key is the oldest preview.
    held.delete(held.keys().next().value as string);
  }
  held.set(token, { account: account.toLowerCase(), ids: [...ids], heldAt: now });
}

/** The set held under this token for this account, if it is still held. Does not remove it. */
export function heldSet(token: string, account: string, now = Date.now()): string[] | undefined {
  dropExpired(now);
  const set = held.get(token);
  return set && set.account === account.toLowerCase() ? [...set.ids] : undefined;
}

/** Remove a set; an applied preview is used once. */
export function releaseSet(token: string): void {
  held.delete(token);
}

/** How many sets are held. For tests and diagnostics. */
export function heldSetCount(now = Date.now()): number {
  dropExpired(now);
  return held.size;
}

/** Drop every held set. For tests. */
export function clearHeldSets(): void {
  held.clear();
}
