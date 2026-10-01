/**
 * Drafts: listDrafts hydration + deleteDraft.
 *
 * Drafts are their own Gmail resource. users.drafts.list returns one bare
 * {id: draftId, message: {id, threadId}} per draft, and users.drafts.delete takes
 * the DRAFT id — not the message id a `search in:drafts` returns. The bugs this
 * suite guards against are the shape ones: a draft list that shows draft ids but
 * no recipient/subject (indistinguishable drafts), and a deleteDraft that is
 * handed a message id and does nothing while claiming success.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../google/client.js');
import { mockCall } from '../../server/handlers/__mocks__/client.js';

import { gmailPatch } from '../../../services/gmail/patch.js';
import type { PatchContext } from '../../../factory/types.js';

const ctx = { operation: 'listDrafts', params: {}, account: 'me@test.com' };

/** A draft's message, as users.messages.get (metadata format) returns it. */
function draftMessage(id: string, to = 'bob@test.com', subject = 'Hello'): Record<string, unknown> {
  return {
    id,
    threadId: 't-1',
    snippet: 'draft snippet',
    payload: { headers: [
      { name: 'From', value: 'me@test.com' },
      { name: 'To', value: to },
      { name: 'Subject', value: subject },
      { name: 'Date', value: 'Sun, 12 Jul 2026 10:00:00 -0500' },
    ] },
  };
}

beforeEach(() => mockCall.mockReset());

describe('listDrafts afterExecute', () => {
  it('hydrates each draft with recipient/subject/date, keeping the DRAFT id on the row', async () => {
    mockCall
      .mockResolvedValueOnce(draftMessage('m-1', 'bob@test.com', 'Invoice'))
      .mockResolvedValueOnce(draftMessage('m-2', 'carol@test.com', 'Draft reply'));

    const raw = {
      resultSizeEstimate: 2,
      drafts: [
        { id: 'r-111', message: { id: 'm-1', threadId: 't-1' } },
        { id: 'r-222', message: { id: 'm-2', threadId: 't-2' } },
      ],
    };
    const hydrated = await gmailPatch.afterExecute!.listDrafts(raw, ctx) as { drafts: Record<string, unknown>[] };

    // Hydration fetches by MESSAGE id, but the row is keyed by DRAFT id.
    expect(mockCall).toHaveBeenNthCalledWith(1, 'gmail', 'users.messages.get',
      expect.objectContaining({ userId: 'me', id: 'm-1', format: 'metadata' }),
      expect.objectContaining({ account: 'me@test.com' }));

    expect(hydrated.drafts).toEqual([
      expect.objectContaining({ draftId: 'r-111', messageId: 'm-1', to: 'bob@test.com', subject: 'Invoice' }),
      expect.objectContaining({ draftId: 'r-222', messageId: 'm-2', to: 'carol@test.com', subject: 'Draft reply' }),
    ]);
  });

  it('marks a draft it could not fetch, instead of rendering a blank row', async () => {
    mockCall.mockRejectedValueOnce(new Error('boom'));

    const raw = { drafts: [{ id: 'r-1', message: { id: 'm-1', threadId: 't-1' } }] };
    const hydrated = await gmailPatch.afterExecute!.listDrafts(raw, ctx) as { drafts: Record<string, unknown>[] };

    const row = hydrated.drafts[0];
    expect(row.draftId).toBe('r-1');
    expect(row.error).toBeTruthy();

    // And the reader SEES it in the list, not a draft with no recipient.
    const rendered = gmailPatch.formatList!({ drafts: hydrated.drafts }, ctx).text;
    expect(rendered).toContain('⚠');
    expect(rendered).toContain('r-1 |');
  });

  it('returns an empty list when there are no drafts', async () => {
    const hydrated = await gmailPatch.afterExecute!.listDrafts(
      { drafts: [], resultSizeEstimate: 0 }, ctx) as { drafts: unknown[] };
    expect(hydrated.drafts).toEqual([]);
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe('formatDraftList', () => {
  it('renders the DRAFT id first, so deleteDraft can be driven from the row', () => {
    const data = { drafts: [
      { draftId: 'r-111', messageId: 'm-1', to: 'bob@test.com', subject: 'Invoice', date: 'Sun, 12 Jul 2026 10:00:00 -0500' },
      { draftId: 'r-222', messageId: 'm-2', to: 'carol@test.com', subject: 'Draft reply', date: 'Mon, 13 Jul 2026 09:00:00 -0500' },
    ] };
    const result = gmailPatch.formatList!(data, ctx);

    expect(result.text).toContain('## Drafts (2)');
    expect(result.text).toContain('r-111 | bob@test.com | Invoice');
    expect(result.text).toContain('r-222 | carol@test.com | Draft reply');
    expect(result.refs).toMatchObject({
      count: 2,
      draftId: 'r-111',
      draftIds: ['r-111', 'r-222'],
      messageIds: ['m-1', 'm-2'],
    });
  });

  it('renders an empty state, not an error, when the list is empty', () => {
    const ctxEmpty: PatchContext = { ...ctx, params: {} };
    const result = gmailPatch.formatList!({ drafts: [], resultSizeEstimate: 0 }, ctxEmpty);
    expect(result.text).toBe('No drafts found.');
    expect(result.refs).toEqual({ count: 0 });
  });
});

describe('deleteDraft custom handler', () => {
  it('deletes by DRAFT id and confirms with that id', async () => {
    // Google answers a successful drafts.delete with an empty 204 body.
    mockCall.mockResolvedValueOnce({});

    const handler = gmailPatch.customHandlers!.deleteDraft!;
    const result = await handler({ draftId: 'r-111' }, 'me@test.com');

    expect(mockCall).toHaveBeenCalledWith(
      'gmail',
      'users.drafts.delete',
      { userId: 'me', id: 'r-111' },
      expect.objectContaining({ account: 'me@test.com' }),
    );
    expect(result.text).toContain('r-111');
    expect(result.refs).toEqual({ draftId: 'r-111', deleted: true });
  });

  it('refuses to delete without a draft id', async () => {
    const handler = gmailPatch.customHandlers!.deleteDraft!;
    await expect(handler({}, 'me@test.com')).rejects.toThrow(/draftId/);
    expect(mockCall).not.toHaveBeenCalled();
  });
});
