/**
 * The client retries what Google says is worth retrying.
 *
 * Google throttles per USER, not per process. Two clients signed in to the same
 * account — a desktop app and an editor, say — share one quota, so a burst of reads
 * can be rejected with a 429 even though every request is perfectly valid. There was
 * no retry at all: the first 429 threw, and callers were left to cope. The Gmail
 * hydrate "coped" by swallowing the error and emitting a row with no sender and no
 * subject, so a rate-limited inbox rendered as blank lines and reported success.
 *
 * Retrying belongs here, once, rather than in every caller.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../accounts/token-service.js', () => ({
  getAccessToken: vi.fn(async () => 'test-token'),
}));

import { call } from '../../google/client.js';
import { GoogleApiError } from '../../google/errors.js';
import { loadDescriptor } from '../../google/descriptor.js';

const ACCOUNT = 'user@test.com';

/** A fetch that replays a scripted sequence of statuses. */
function scriptedFetch(steps: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const impl = (async (input: unknown) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push(String(input));
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: (h: string) => step.headers?.[h.toLowerCase()] ?? null },
      text: async () => JSON.stringify(step.body ?? { error: { code: step.status, message: 'boom' } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

let descriptor: Awaited<ReturnType<typeof loadDescriptor>>;

beforeEach(async () => {
  descriptor = await loadDescriptor();
  // Backoff sleeps for real time. Make the clock free so the test isn't slow.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
});

describe('call() retry', () => {
  it('retries a 429 and returns the eventual success', async () => {
    // The exact shape of the reported bug: a throttled read that would have become a
    // blank row. It must recover instead.
    const { impl, calls } = scriptedFetch([
      { status: 429 },
      { status: 429 },
      { status: 200, body: { id: 'msg-1', snippet: 'hello' } },
    ]);

    const result = await call('gmail', 'users.messages.get',
      { userId: 'me', id: 'msg-1' },
      { account: ACCOUNT, descriptor, fetchImpl: impl }) as Record<string, unknown>;

    expect(result.id).toBe('msg-1');
    expect(calls).toHaveLength(3);
  });

  it('retries 5xx too — Google having a moment is not our error', async () => {
    const { impl, calls } = scriptedFetch([
      { status: 503 },
      { status: 200, body: { ok: true } },
    ]);

    await call('gmail', 'users.messages.get',
      { userId: 'me', id: 'm' },
      { account: ACCOUNT, descriptor, fetchImpl: impl });

    expect(calls).toHaveLength(2);
  });

  it('does NOT retry a 404 — the message is gone, asking again will not find it', async () => {
    const { impl, calls } = scriptedFetch([
      { status: 404, body: { error: { code: 404, message: 'Not Found', errors: [{ reason: 'notFound' }] } } },
    ]);

    await expect(call('gmail', 'users.messages.get',
      { userId: 'me', id: 'nope' },
      { account: ACCOUNT, descriptor, fetchImpl: impl })).rejects.toThrow(GoogleApiError);

    // Retrying a client error burns quota to be told the same thing.
    expect(calls).toHaveLength(1);
  });

  it('gives up after a bounded number of attempts, and surfaces Google\'s error', async () => {
    // Retrying forever is its own failure — the caller hangs instead of being told.
    const { impl, calls } = scriptedFetch([{ status: 429 }]);

    await expect(call('gmail', 'users.messages.get',
      { userId: 'me', id: 'm' },
      { account: ACCOUNT, descriptor, fetchImpl: impl })).rejects.toMatchObject({ status: 429 });

    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it('honours Retry-After when Google sends one', async () => {
    const { impl } = scriptedFetch([
      { status: 429, headers: { 'retry-after': '2' } },
      { status: 200, body: { ok: true } },
    ]);

    await call('gmail', 'users.messages.get',
      { userId: 'me', id: 'm' },
      { account: ACCOUNT, descriptor, fetchImpl: impl });

    // Google told us how long to wait; we waited that long, not a number we made up.
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 2000);
  });
});
