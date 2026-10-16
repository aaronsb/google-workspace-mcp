/**
 * Label changes over everything a query matches (ADR-310, #206): the preview resolves and
 * holds the set, the apply changes exactly that set, once, and no ids pass through.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../../google/client.js');
import { call } from '../../../google/client.js';
import { runAsToolCall } from '../../../server/call-context.js';
import { clearHeldSets, heldSetCount } from '../../../server/preview-sets.js';
import { handleModifyMatching, handlePreviewModifyMatching } from '../../../services/gmail/modify-matching.js';

const mockCall = call as MockedFunction<typeof call>;
const ACCOUNT = 'me@test.com';

interface Mailbox {
  /** Ids messages.list returns for the query, newest first. */
  matches: string[];
  /** Each batchModify call's body, in order. */
  modified: Array<Record<string, unknown>>;
  /** Fail the batchModify call with this index (0-based). */
  failBatch?: number;
}

let box: Mailbox;

beforeEach(() => {
  box = { matches: ['m1', 'm2', 'm3'], modified: [] };
  mockCall.mockReset();
  mockCall.mockImplementation(async (_svc, method, p) => {
    const params = p as Record<string, unknown>;
    switch (method) {
      case 'users.labels.list':
        return { labels: [{ id: 'INBOX', name: 'INBOX' }, { id: 'UNREAD', name: 'UNREAD' }, { id: 'TRASH', name: 'TRASH' }, { id: 'Label_7', name: 'Vendor/Billing' }] };
      case 'users.messages.list': {
        const start = params.pageToken ? Number(params.pageToken) : 0;
        const size = Number(params.maxResults);
        const page = box.matches.slice(start, start + size);
        const next = start + size < box.matches.length ? String(start + size) : undefined;
        return { messages: page.map((id) => ({ id })), resultSizeEstimate: 7, ...(next ? { nextPageToken: next } : {}) };
      }
      case 'users.messages.get':
        return { id: params.id, payload: { headers: [{ name: 'From', value: 'billing@vendor.test' }, { name: 'Subject', value: 'Invoice' }] } };
      case 'users.messages.batchModify':
        if (box.failBatch === box.modified.length) {
          box.modified.push({ failed: true });
          throw new Error('backend error');
        }
        box.modified.push(params);
        return {};
      default:
        throw new Error(`unexpected call ${method}`);
    }
  });
});
afterEach(() => clearHeldSets());

const ARCHIVE = { query: 'from:billing@vendor.test', addLabelIds: 'Label_7', removeLabelIds: 'INBOX' };

async function preview(params: Record<string, unknown> = ARCHIVE) {
  return runAsToolCall(() => handlePreviewModifyMatching(params, ACCOUNT));
}
const apply = (params: Record<string, unknown>) => runAsToolCall(() => handleModifyMatching(params, ACCOUNT));

describe('previewModifyMatching', () => {
  it('counts every match exactly, past one page, and describes the change', async () => {
    box.matches = Array.from({ length: 1234 }, (_, i) => `m${i}`);
    const out = await preview();
    expect(out.text).toContain('**Matches:** 1,234 messages.');
    expect(out.text).toContain('archived: removed from the inbox');
    expect(out.text).toContain('labeled "Vendor/Billing"');
    expect(out.refs).toMatchObject({ matchCount: 1234 });
    expect(out.refs?.previewToken).toBeTypeOf('string');
  });

  it('returns no ids beyond the sample', async () => {
    box.matches = Array.from({ length: 40 }, (_, i) => `msg${String(i).padStart(3, '0')}`);
    const out = await preview();
    const shown = box.matches.filter((id) => out.text.includes(id));
    expect(shown).toEqual(box.matches.slice(0, 5));
    expect(JSON.stringify(out.refs)).not.toContain('msg039');
  });

  it('calls trash a bulk trash and says how to undo it in bulk', async () => {
    const out = await preview({ query: 'older_than:5y', addLabelIds: 'TRASH' });
    expect(out.text).toContain('⚠ moved to trash. This is a bulk trash. Gmail deletes trash permanently after 30 days');
    expect(out.text).toContain('with `in:trash` added and removeLabelIds TRASH to restore them');
  });

  it('describes restoring from trash, and does not claim trash is excluded when the query names it', async () => {
    const out = await preview({ query: 'in:trash from:billing@vendor.test', removeLabelIds: 'TRASH' });
    expect(out.text).toContain('- restored from trash');
    expect(out.text).not.toContain('Spam and trash are not included');
    expect((await preview()).text).toContain('Spam and trash are not included');
  });

  it('refuses a label Gmail sets itself', async () => {
    const out = await preview({ query: 'x', removeLabelIds: 'SENT' });
    expect(out.text).toContain('SENT is set by Gmail itself');
    expect(out.refs?.previewToken).toBeUndefined();
  });

  it('withholds the token past 10,000 matches and says how to narrow', async () => {
    box.matches = Array.from({ length: 10_400 }, (_, i) => `m${i}`);
    const out = await preview();
    expect(out.text).toContain('More than 10,000 messages match');
    expect(out.text).toContain('after: and before:');
    expect(out.refs?.previewToken).toBeUndefined();
    expect(heldSetCount()).toBe(0);
  });

  it('withholds the token for a label it cannot find, giving the id for a name', async () => {
    const out = await preview({ query: 'x', addLabelIds: 'vendor/billing' });
    expect(out.text).toContain("'vendor/billing' is a label name; this takes its id, Label_7.");
    expect(out.refs?.previewToken).toBeUndefined();
  });

  it('issues nothing when nothing matches', async () => {
    box.matches = [];
    const out = await preview();
    expect(out.text).toContain('Nothing matches');
    expect(out.refs?.previewToken).toBeUndefined();
  });

  it('refuses a change with nothing to change, or a label both added and removed', async () => {
    await expect(preview({ query: 'x' })).rejects.toThrow(/at least one change/);
    await expect(preview({ query: 'x', addLabelIds: 'INBOX', removeLabelIds: 'INBOX' })).rejects.toThrow(/both added and removed: INBOX/);
  });
});

describe('modifyMatching', () => {
  it('changes exactly the previewed set, in chunks of 1,000, and reports the count', async () => {
    box.matches = Array.from({ length: 2500 }, (_, i) => `m${i}`);
    const token = (await preview()).refs?.previewToken;
    const out = await apply({ ...ARCHIVE, previewToken: token });
    expect(box.modified.map((b) => (b.ids as string[]).length)).toEqual([1000, 1000, 500]);
    expect(box.modified[0]).toMatchObject({ userId: 'me', addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] });
    expect(box.modified.flatMap((b) => b.ids as string[])).toEqual(box.matches);
    expect(out.text).toContain('Changed 2,500 messages');
    expect(out.refs).toEqual({ query: 'from:billing@vendor.test', changed: 2500 });
  });

  it('leaves alone mail that started matching after the preview', async () => {
    const token = (await preview()).refs?.previewToken;
    box.matches = ['new1', ...box.matches];
    await apply({ ...ARCHIVE, previewToken: token });
    expect(box.modified[0].ids).toEqual(['m1', 'm2', 'm3']);
  });

  it('applies once', async () => {
    const token = (await preview()).refs?.previewToken;
    await apply({ ...ARCHIVE, previewToken: token });
    const again = await apply({ ...ARCHIVE, previewToken: token });
    expect(again.text).toContain('no longer held');
    expect(again.refs?.blocked).toBe(true);
    expect(box.modified).toHaveLength(1);
  });

  it('refuses without a token, says why in its own terms, and changes nothing', async () => {
    const out = await apply(ARCHIVE);
    expect(out.text).toContain('needs a previewToken. It changes every message a query matched');
    expect(out.text).not.toContain('not arrived');
    expect(box.modified).toHaveLength(0);
  });

  it('changes nothing and keeps the preview when the label lookup fails before the write', async () => {
    const token = (await preview()).refs?.previewToken;
    const real = mockCall.getMockImplementation()!;
    mockCall.mockImplementation(async (svc, method, p, o) => {
      if (method === 'users.labels.list') throw new Error('rate limited');
      return real(svc, method, p, o);
    });
    await expect(apply({ ...ARCHIVE, previewToken: token })).rejects.toThrow(/rate limited/);
    expect(box.modified).toHaveLength(0);
    mockCall.mockImplementation(real);
    const out = await apply({ ...ARCHIVE, previewToken: token });
    expect(out.refs).toMatchObject({ changed: 3 });
  });

  it('refuses a change edited after the preview, and keeps the set for the right call', async () => {
    const token = (await preview()).refs?.previewToken;
    const edited = await apply({ ...ARCHIVE, addLabelIds: 'TRASH', previewToken: token });
    expect(edited.text).toContain('does not match this change');
    expect(box.modified).toHaveLength(0);
    await apply({ ...ARCHIVE, previewToken: token });
    expect(box.modified).toHaveLength(1);
  });

  it('refuses a preview chained into it within one tool call', async () => {
    const out = await runAsToolCall(async () => {
      const p = await handlePreviewModifyMatching(ARCHIVE, ACCOUNT);
      return handleModifyMatching({ ...ARCHIVE, previewToken: p.refs?.previewToken }, ACCOUNT);
    });
    expect(out.text).toContain('same tool call');
    expect(box.modified).toHaveLength(0);
  });

  it('refuses a filter token and names what it was for', async () => {
    const forged = Buffer.from(JSON.stringify({ k: 'manage_email.createFilter', t: Date.now(), c: 1 })).toString('base64url');
    const out = await apply({ ...ARCHIVE, previewToken: `${forged}.AAAA` });
    expect(out.text).toContain('came from a preview for manage_email.createFilter');
  });

  it('refuses on another account', async () => {
    const token = (await preview()).refs?.previewToken;
    const out = await runAsToolCall(() => handleModifyMatching({ ...ARCHIVE, previewToken: token }, 'other@test.com'));
    expect(out.text).toContain('no longer held');
    expect(box.modified).toHaveLength(0);
  });

  it('stops at a failed chunk, says how far it got, and does not leave the set to be re-applied', async () => {
    box.matches = Array.from({ length: 2500 }, (_, i) => `m${i}`);
    const token = (await preview()).refs?.previewToken;
    box.failBatch = 1;
    await expect(apply({ ...ARCHIVE, previewToken: token }))
      .rejects.toThrow(/changed 1000 of 2500 messages, then the batch starting at message 1001 failed/);
    expect(box.modified).toHaveLength(2);
    expect(heldSetCount()).toBe(0);
  });
});
