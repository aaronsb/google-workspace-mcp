/**
 * A message we could not READ must never look like a message with NOTHING IN IT.
 *
 * The reported symptom, from a real mailbox: the tail of a triage listing came back as
 *
 *     19f5129863afedf6 |  | (no subject) |
 *
 * — same ids that had rendered fine minutes earlier. The cause was a bare
 * `catch { return { id: msg.id } }` around the per-message fetch. Every failure became
 * a row with no sender, no subject and no date: indistinguishable from an empty email,
 * and reported as success. The reader has no way to tell "this message is blank" from
 * "I could not fetch this message".
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../../google/client.js');
import { call } from '../../../google/client.js';
import { GoogleApiError } from '../../../google/errors.js';
import { gmailPatch } from '../../../services/gmail/patch.js';
import { formatEmailList } from '../../../server/formatting/markdown.js';

const mockCall = call as MockedFunction<typeof call>;
const ctx = { operation: 'triage', params: {}, account: 'me@test.com' };

function message(id: string) {
  return {
    id,
    threadId: 't',
    snippet: 's',
    payload: { headers: [
      { name: 'From', value: 'alice@test.com' },
      { name: 'Subject', value: 'Hello' },
      { name: 'Date', value: 'Sun, 12 Jul 2026 10:00:00 -0500' },
    ] },
  };
}

beforeEach(() => mockCall.mockReset());

describe('triage / search hydrate', () => {
  it('marks a message it could not fetch, instead of rendering a blank row', async () => {
    // Two succeed, the third is throttled even after the client's retries.
    mockCall
      .mockResolvedValueOnce(message('a'))
      .mockResolvedValueOnce(message('b'))
      .mockRejectedValueOnce(new GoogleApiError(429, {
        error: { code: 429, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] },
      }, { url: '', method: 'GET' }));

    const raw = { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const hydrated = await gmailPatch.afterExecute!.triage(raw, ctx) as { messages: Record<string, unknown>[] };

    const failed = hydrated.messages.find((m) => m.id === 'c')!;
    expect(failed.error).toBeTruthy();
    expect(String(failed.error)).toContain('429');

    // And the user SEES it — the whole point. A blank row would say nothing.
    const rendered = formatEmailList(hydrated).text;
    expect(rendered).toContain('⚠');
    expect(rendered).toContain('c |');
    expect(rendered).not.toMatch(/^c \| *\| \(no subject\)/m);   // the old blank row
  });

  it('still renders the messages that DID load', async () => {
    // A partial failure must not cost the rows that worked.
    mockCall
      .mockResolvedValueOnce(message('a'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(message('c'));

    const raw = { messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const hydrated = await gmailPatch.afterExecute!.triage(raw, ctx) as { messages: Record<string, unknown>[] };

    expect(hydrated.messages).toHaveLength(3);
    expect(hydrated.messages[0].subject).toBe('Hello');
    expect(hydrated.messages[2].subject).toBe('Hello');
    expect(hydrated.messages[1].error).toBeTruthy();
  });

  it('preserves order — row N is the id the caller asked for at N', async () => {
    // Bounded concurrency means results arrive out of order. If the results were
    // pushed as they landed, the id in a row would drift away from its content and
    // every subsequent `read` would open the wrong message.
    const ids = ['a', 'b', 'c', 'd'];

    // Workers claim indices in order, so the Nth invocation is the Nth id. Make the
    // FIRST one resolve LAST: if results were appended as they landed rather than
    // written to their own slot, 'a' would end up at the bottom of the list.
    let invocation = 0;
    mockCall.mockImplementation((async () => {
      const i = invocation++;
      if (i === 0) await new Promise((r) => setTimeout(r, 20));
      return message(ids[i]);
    }) as never);

    const raw = { messages: ids.map((id) => ({ id })) };
    const hydrated = await gmailPatch.afterExecute!.triage(raw, ctx) as { messages: Record<string, unknown>[] };

    expect(hydrated.messages.map((m) => m.id)).toEqual(ids);
  });
});
