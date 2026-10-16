/**
 * Hydration — turn the bare ids Gmail's list methods return into rows a reader can use.
 *
 * `messages.list` and `drafts.list` return ids and nothing else, so every row costs one
 * `messages.get`. Shared by search, triage, listDrafts and the filter preview.
 */

import { call } from '../../google/client.js';
import { GoogleApiError } from '../../google/errors.js';

/**
 * Hydrate message IDs with metadata (From, Subject, Date, snippet).
 * Reused from the original email handler.
 */
export async function hydrateMessages(
  messageIds: Array<{ id: string }>,
  account: string,
): Promise<Record<string, unknown>[]> {
  // Google throttles per USER, not per process, so this burst competes with every
  // other client signed in to the same account. Firing all 50 at once is the surest
  // way to be told no. A modest window is barely slower — the calls still overlap —
  // and it is far less likely to be throttled in the first place.
  return mapLimited(messageIds, HYDRATE_CONCURRENCY, async (msg) => {
    try {
      const data = await call('gmail', 'users.messages.get', {
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      }, { account }) as Record<string, unknown>;
      const headers = ((data.payload as Record<string, unknown>)?.headers ?? []) as Array<{ name: string; value: string }>;
      const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
      return {
        id: data.id,
        threadId: data.threadId,
        from: getHeader('from'),
        subject: getHeader('subject'),
        date: getHeader('date'),
        snippet: data.snippet,
      };
    } catch (err) {
      // A message we could not READ must never look like a message with NOTHING IN IT.
      //
      // This used to `catch { return { id: msg.id } }` — every failure became a row
      // with no sender, no subject and no date, indistinguishable from a genuinely
      // empty message. Under rate limiting the tail of an inbox silently rendered as
      // blank lines, and the tool reported success while showing the user nothing.
      //
      // The client retries a 429 now, so reaching here means it did not recover. Say
      // so, in the row, where the person reading the list will actually see it.
      return {
        id: msg.id,
        error: err instanceof GoogleApiError
          ? `could not load (${err.status}${err.reason ? ' ' + err.reason : ''})`
          : `could not load (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  });
}

/** Concurrent, but bounded. */
const HYDRATE_CONCURRENCY = 8;

/**
 * Hydrate draft resources with message metadata (From, To, Subject, Date, snippet).
 *
 * users.drafts.list returns one bare {id: draftId, message: {id, threadId}} per draft —
 * enough to identify a draft, nothing to tell drafts apart. Each draft's message is
 * fetched (metadata format, exactly like the search/triage hydration) and the DRAFT id
 * stays on the row, because it — not the message id — is what deleteDraft addresses.
 */
export async function hydrateDrafts(
  drafts: Array<{ id: string; message?: { id?: string; threadId?: string } }>,
  account: string,
): Promise<Record<string, unknown>[]> {
  return mapLimited(drafts, HYDRATE_CONCURRENCY, async (draft) => {
    const draftId = draft.id;
    const messageId = draft.message?.id;
    if (!messageId) {
      return { draftId, error: 'draft carries no message id' };
    }
    try {
      const data = await call('gmail', 'users.messages.get', {
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      }, { account }) as Record<string, unknown>;
      const headers = ((data.payload as Record<string, unknown>)?.headers ?? []) as Array<{ name: string; value: string }>;
      const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
      return {
        draftId,
        messageId: data.id,
        threadId: data.threadId,
        to: getHeader('to'),
        from: getHeader('from'),
        subject: getHeader('subject'),
        date: getHeader('date'),
        snippet: data.snippet,
      };
    } catch (err) {
      return {
        draftId,
        messageId,
        error: err instanceof GoogleApiError
          ? `could not load (${err.status}${err.reason ? ' ' + err.reason : ''})`
          : `could not load (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  });
}

export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);      // fn never rejects — it catches internally
    }
  });
  await Promise.all(workers);
  return results;
}
