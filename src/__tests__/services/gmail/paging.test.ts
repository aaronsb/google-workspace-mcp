/**
 * A list that stops before the end says so (ADR-309 §3, #203).
 *
 * The reported case: every search returned exactly 50 rows with nothing to say more
 * existed, so the agent could only bisect by date and conclude "at least 400".
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../../google/client.js');
import { call } from '../../../google/client.js';
import { gmailPatch } from '../../../services/gmail/patch.js';

const mockCall = call as MockedFunction<typeof call>;
const ACCOUNT = 'me@test.com';
const ctx = (operation: string, params: Record<string, unknown> = {}) => ({ operation, params, account: ACCOUNT });

function message(id: string) {
  return {
    id,
    threadId: 't',
    snippet: 's',
    payload: { headers: [
      { name: 'From', value: 'billing@vendor.test' },
      { name: 'Subject', value: 'Invoice' },
      { name: 'Date', value: 'Sun, 12 Jul 2026 10:00:00 -0500' },
    ] },
  };
}

beforeEach(() => {
  mockCall.mockReset();
  mockCall.mockImplementation(async (_svc, _method, params) => message(String((params as { id: string }).id)));
});

async function search(raw: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const c = ctx('search', params);
  const data = await gmailPatch.afterExecute!.search(raw, c);
  return gmailPatch.formatList!(data, c);
}

describe('search paging', () => {
  it('says more results exist, labels the estimate, and gives the token to continue', async () => {
    const out = await search({ messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'NEXT', resultSizeEstimate: 412 });
    expect(out.text).toContain('More results exist');
    expect(out.text).toContain('about 412');
    expect(out.text).toContain('estimate');
    expect(out.text).toContain('pageToken: NEXT');
    expect(out.refs).toMatchObject({ nextPageToken: 'NEXT', resultSizeEstimate: 412 });
  });

  it('says nothing extra when the page is the whole result', async () => {
    const out = await search({ messages: [{ id: 'a' }], resultSizeEstimate: 1 });
    expect(out.text).not.toContain('More results exist');
    expect(out.refs?.nextPageToken).toBeUndefined();
  });

  it('names the operation the caller should call again', async () => {
    const c = ctx('threads');
    const out = gmailPatch.formatList!({ threads: [{ id: 't1', snippet: 'x' }], nextPageToken: 'T2' }, c);
    expect(out.text).toContain('Call `threads` again with pageToken: T2');
  });

  it('keeps the token through draft hydration', async () => {
    mockCall.mockImplementation(async () => message('m1'));
    const c = ctx('listDrafts');
    const data = await gmailPatch.afterExecute!.listDrafts({ drafts: [{ id: 'r1', message: { id: 'm1' } }], nextPageToken: 'D2' }, c);
    expect(gmailPatch.formatList!(data, c).text).toContain('pageToken: D2');
  });
});

describe('search idsOnly', () => {
  it('returns the ids without fetching a single message', async () => {
    const out = await search({ messages: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], nextPageToken: 'N' }, { idsOnly: true });
    expect(mockCall).not.toHaveBeenCalled();
    expect(out.text).toContain('a,b,c');
    expect(out.refs).toMatchObject({ count: 3, ids: ['a', 'b', 'c'], nextPageToken: 'N' });
  });

  it('pages at 500, the API limit, rather than the hydration cap of 50', () => {
    const before = gmailPatch.beforeExecute!.search;
    expect(before({ q: 'x', maxResults: 50 }, ctx('search', { idsOnly: true }))).toMatchObject({ maxResults: 500 });
    expect(before({ q: 'x', maxResults: 50 }, ctx('search', { idsOnly: true, maxResults: 120 }))).toMatchObject({ maxResults: 120 });
    expect(before({ q: 'x', maxResults: 50 }, ctx('search', { idsOnly: true, maxResults: 9000 }))).toMatchObject({ maxResults: 500 });
  });

  it('leaves an ordinary search at its cap', () => {
    expect(gmailPatch.beforeExecute!.search({ q: 'x', maxResults: 50 }, ctx('search'))).toMatchObject({ maxResults: 50 });
  });

  it('does not apply to triage, which has no idsOnly', async () => {
    const c = ctx('triage', { idsOnly: true });
    const data = await gmailPatch.afterExecute!.triage({ messages: [{ id: 'a' }] }, c) as { messages?: unknown[] };
    expect(data.messages).toHaveLength(1);
  });
});
