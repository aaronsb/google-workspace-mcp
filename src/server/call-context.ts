/**
 * Which top-level tool call the current code is running inside.
 *
 * A `bulk_operations` queue runs its operations by calling their handlers directly, inside
 * the one tool call that carried the queue, so everything a queue does shares that call's
 * id. The preview gate (ADR-309) reads it to refuse a token minted earlier in the same
 * call: a preview chained straight into a write returns nothing to the caller between them.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ callId: number }>();
let lastCallId = 0;

/** Run `fn` as a new top-level tool call. */
export function runAsToolCall<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ callId: ++lastCallId }, fn);
}

/** The id of the tool call in progress; 0 outside one (tests, startup). */
export function currentCallId(): number {
  return storage.getStore()?.callId ?? 0;
}
