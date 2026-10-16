/**
 * The Gmail filter lifecycle and its preview gate (ADR-309, #202).
 *
 * Google is replaced by an in-memory mailbox: filters, labels, forwarding addresses and a
 * message list, enough for every call the handlers make.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../../google/client.js');
import { call } from '../../../google/client.js';
import { GoogleApiError } from '../../../google/errors.js';
import { runAsToolCall } from '../../../server/call-context.js';
import {
  buildFilterSpec,
  criteriaToQuery,
  handleCreateFilter,
  handleDeleteFilter,
  handleGetFilter,
  handleListFilters,
  handlePreviewFilter,
  handleUpdateFilter,
} from '../../../services/gmail/filters.js';

const mockCall = call as MockedFunction<typeof call>;
const ACCOUNT = 'me@test.com';

interface Mailbox {
  filters: Array<Record<string, unknown>>;
  labels: Array<{ id: string; name: string }>;
  forwarding: Array<{ forwardingEmail: string; verificationStatus: string }>;
  /** Ids returned for any messages.list query. */
  matches: string[];
  nextId: number;
  /** Make filters.delete throw this. */
  deleteError?: Error;
}

let box: Mailbox;

function notFound(): GoogleApiError {
  return new GoogleApiError(404, { error: { code: 404, message: 'Not Found' } }, { url: '', method: 'GET' });
}

beforeEach(() => {
  box = {
    filters: [],
    labels: [
      { id: 'INBOX', name: 'INBOX' }, { id: 'UNREAD', name: 'UNREAD' }, { id: 'TRASH', name: 'TRASH' },
      { id: 'Label_7', name: 'Vendor/Billing' },
    ],
    forwarding: [{ forwardingEmail: 'ap@example.com', verificationStatus: 'accepted' }],
    matches: ['m1', 'm2', 'm3'],
    nextId: 1,
  };
  mockCall.mockReset();
  mockCall.mockImplementation(async (_svc, method, p) => {
    const params = p as Record<string, unknown>;
    switch (method) {
      case 'users.settings.filters.list':
        return box.filters.length ? { filter: box.filters } : {};
      case 'users.settings.filters.get': {
        const f = box.filters.find((x) => x.id === params.id);
        if (!f) throw notFound();
        return f;
      }
      case 'users.settings.filters.create': {
        const f = { id: `F${box.nextId++}`, criteria: params.criteria, action: params.action };
        box.filters.push(f);
        return f;
      }
      case 'users.settings.filters.delete': {
        if (box.deleteError) throw box.deleteError;
        const before = box.filters.length;
        box.filters = box.filters.filter((x) => x.id !== params.id);
        if (box.filters.length === before) throw notFound();
        return {};
      }
      case 'users.labels.list':
        return { labels: box.labels };
      case 'users.settings.forwardingAddresses.list':
        return { forwardingAddresses: box.forwarding };
      case 'users.messages.list': {
        const start = params.pageToken ? Number(params.pageToken) : 0;
        const size = Number(params.maxResults);
        const page = box.matches.slice(start, start + size);
        const next = start + size < box.matches.length ? String(start + size) : undefined;
        return { messages: page.map((id) => ({ id })), resultSizeEstimate: 999, ...(next ? { nextPageToken: next } : {}) };
      }
      case 'users.messages.get':
        return { id: params.id, payload: { headers: [{ name: 'From', value: 'billing@vendor.test' }, { name: 'Subject', value: 'Invoice' }] } };
      default:
        throw new Error(`unexpected call ${method}`);
    }
  });
});

const ARCHIVE_AND_LABEL = { matchFrom: 'billing@vendor.test', addLabelIds: 'Label_7', removeLabelIds: 'INBOX' };

/** Preview in its own tool call, as a client would, and return the token. */
async function previewToken(params: Record<string, unknown>): Promise<string> {
  const out = await runAsToolCall(() => handlePreviewFilter(params, ACCOUNT));
  const token = out.refs?.previewToken;
  expect(token, out.text).toBeTypeOf('string');
  return token as string;
}

const write = <T>(fn: () => Promise<T>) => runAsToolCall(fn);

describe('buildFilterSpec', () => {
  it('needs a criterion and an action', () => {
    expect(() => buildFilterSpec({ addLabelIds: 'Label_7' })).toThrow(/at least one criterion/);
    expect(() => buildFilterSpec({ matchExcludeChats: true, addLabelIds: 'Label_7' })).toThrow(/at least one criterion/);
    expect(() => buildFilterSpec({ matchFrom: 'a@b.c' })).toThrow(/at least one action/);
  });

  it('pairs size with its comparison', () => {
    expect(() => buildFilterSpec({ matchSize: 1000, addLabelIds: 'Label_7' })).toThrow(/go together/);
    expect(() => buildFilterSpec({ matchSize: 1000, matchSizeComparison: 'bigger', addLabelIds: 'Label_7' })).toThrow(/larger/);
    expect(buildFilterSpec({ matchSize: 1000, matchSizeComparison: 'larger', addLabelIds: 'Label_7' }).criteria)
      .toEqual({ size: 1000, sizeComparison: 'larger' });
  });

  it('refuses a boolean it cannot read, rather than dropping the criterion', () => {
    for (const value of ['True', 1, '1', 'yes']) {
      expect(() => buildFilterSpec({ matchFrom: 'a@b.c', matchHasAttachment: value, addLabelIds: 'Label_7' }), String(value))
        .toThrow(/matchHasAttachment must be true or false/);
    }
    expect(buildFilterSpec({ matchFrom: 'a@b.c', matchHasAttachment: 'true', addLabelIds: 'Label_7' }).criteria.hasAttachment).toBe(true);
    expect(buildFilterSpec({ matchFrom: 'a@b.c', matchHasAttachment: 'false', addLabelIds: 'Label_7' }).criteria.hasAttachment).toBeUndefined();
  });

  it('takes a size Gmail can store: a whole number of bytes within int32', () => {
    for (const size of [1.5, 2 ** 31, -5, 'big']) {
      expect(() => buildFilterSpec({ matchSize: size, matchSizeComparison: 'larger', addLabelIds: 'Label_7' }), String(size))
        .toThrow(/whole number of bytes/);
    }
    expect(buildFilterSpec({ matchSize: '2048', matchSizeComparison: 'larger', addLabelIds: 'Label_7' }).criteria.size).toBe(2048);
  });

  it('normalizes so equivalent filters compare equal', () => {
    const a = buildFilterSpec({ matchFrom: ' x@y.z ', addLabelIds: 'Label_7, STARRED', forwardTo: 'AP@Example.com' });
    const b = buildFilterSpec({ matchFrom: 'x@y.z', addLabelIds: 'STARRED,Label_7,STARRED', forwardTo: 'ap@example.com' });
    expect(a).toEqual(b);
  });
});

describe('criteriaToQuery', () => {
  it('writes each criterion in search syntax', () => {
    expect(criteriaToQuery({
      from: 'a@b.c', to: 'list@x.y', subject: 'invoice due', query: 'is:unread', negatedQuery: 'urgent',
      hasAttachment: true, size: 5000, sizeComparison: 'smaller', excludeChats: true,
    })).toBe('from:(a@b.c) to:(list@x.y) subject:(invoice due) (is:unread) -(urgent) has:attachment smaller:5000 -in:chats');
  });
});

describe('previewFilter', () => {
  it('counts matches exactly, shows a sample, says what each action does, and mints a token', async () => {
    const out = await runAsToolCall(() => handlePreviewFilter(ARCHIVE_AND_LABEL, ACCOUNT));
    expect(out.text).toContain('`from:(billing@vendor.test)`');
    expect(out.text).toContain('**Matches today:** 3 messages.');
    expect(out.text).toContain('m1 | billing@vendor.test | Invoice');
    expect(out.text).toContain('skips the inbox');
    expect(out.text).toContain('labeled "Vendor/Billing"');
    expect(out.text).toContain('idsOnly: true');
    expect(out.refs).toMatchObject({ matchCount: 3, matchCountExact: true });
    expect(out.text).toContain('To create it, call `createFilter` with the same parameters and previewToken:');
    expect(out.refs?.previewToken).toBeTypeOf('string');
  });

  it('settles for "at least" past the count cap, and labels the estimate', async () => {
    box.matches = Array.from({ length: 2600 }, (_, i) => `m${i}`);
    const out = await runAsToolCall(() => handlePreviewFilter(ARCHIVE_AND_LABEL, ACCOUNT));
    expect(out.text).toContain('at least 2000');
    expect(out.text).toContain('about 999, which is an estimate');
    expect(out.refs).toMatchObject({ matchCountExact: false });
  });

  it('explains trash and forwarding instead of refusing them', async () => {
    const out = await runAsToolCall(() => handlePreviewFilter(
      { matchFrom: 'x@y.z', addLabelIds: 'TRASH', forwardTo: 'ap@example.com' }, ACCOUNT));
    expect(out.text).toContain('⚠ moved to trash on arrival. Gmail deletes trash permanently after 30 days');
    expect(out.text).toContain('⚠ forwarded in full to ap@example.com. every time, with no further prompt');
    expect(out.refs?.previewToken).toBeTypeOf('string');
  });

  it('withholds the token for a label name passed as an id, and gives the id', async () => {
    const out = await runAsToolCall(() => handlePreviewFilter({ matchFrom: 'x@y.z', addLabelIds: 'vendor/billing' }, ACCOUNT));
    expect(out.text).toContain("'vendor/billing' is a label name; filters take its id, Label_7.");
    expect(out.text).toContain('No previewToken issued');
    expect(out.refs?.previewToken).toBeUndefined();
  });

  it('withholds the token for a forwarding address Gmail would reject', async () => {
    box.forwarding = [{ forwardingEmail: 'ap@example.com', verificationStatus: 'pending' }];
    const pending = await runAsToolCall(() => handlePreviewFilter({ matchFrom: 'x@y.z', forwardTo: 'ap@example.com' }, ACCOUNT));
    expect(pending.text).toContain('not verified yet (pending)');
    const unknown = await runAsToolCall(() => handlePreviewFilter({ matchFrom: 'x@y.z', forwardTo: 'else@example.com' }, ACCOUNT));
    expect(unknown.text).toContain('is not a forwarding address on this account');
    expect(pending.refs?.previewToken ?? unknown.refs?.previewToken).toBeUndefined();
  });

  it('withholds the token for an exact duplicate, and notes an overlap', async () => {
    box.filters = [
      { id: 'OLD', criteria: { from: 'billing@vendor.test' }, action: { addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] } },
    ];
    const dup = await runAsToolCall(() => handlePreviewFilter(ARCHIVE_AND_LABEL, ACCOUNT));
    expect(dup.text).toContain('Filter OLD already does exactly this.');
    expect(dup.refs?.previewToken).toBeUndefined();

    const overlap = await runAsToolCall(() => handlePreviewFilter({ matchFrom: 'billing@vendor.test', removeLabelIds: 'UNREAD' }, ACCOUNT));
    expect(overlap.text).toContain('Filter OLD has the same criteria');
    expect(overlap.refs?.previewToken).toBeTypeOf('string');
  });
});

describe('createFilter', () => {
  it('refuses without a preview, and says which preview to run', async () => {
    const out = await write(() => handleCreateFilter(ARCHIVE_AND_LABEL, ACCOUNT));
    expect(out.text).toContain('needs a previewToken');
    expect(out.text).toContain('previewFilter');
    expect(out.refs?.blocked).toBe(true);
    expect(box.filters).toHaveLength(0);
  });

  it('creates the filter its preview showed', async () => {
    const token = await previewToken(ARCHIVE_AND_LABEL);
    const out = await write(() => handleCreateFilter({ ...ARCHIVE_AND_LABEL, previewToken: token }, ACCOUNT));
    expect(out.refs).toMatchObject({ filterId: 'F1', created: true });
    expect(box.filters[0]).toMatchObject({
      criteria: { from: 'billing@vendor.test' },
      action: { addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] },
    });
  });

  it('refuses a change made after the preview', async () => {
    const token = await previewToken(ARCHIVE_AND_LABEL);
    const out = await write(() => handleCreateFilter({ ...ARCHIVE_AND_LABEL, addLabelIds: 'TRASH', previewToken: token }, ACCOUNT));
    expect(out.text).toContain('does not match this change');
    expect(box.filters).toHaveLength(0);
  });

  it('refuses a preview chained into it within one tool call', async () => {
    const out = await runAsToolCall(async () => {
      const preview = await handlePreviewFilter(ARCHIVE_AND_LABEL, ACCOUNT);
      return handleCreateFilter({ ...ARCHIVE_AND_LABEL, previewToken: preview.refs?.previewToken }, ACCOUNT);
    });
    expect(out.text).toContain('same tool call');
    expect(box.filters).toHaveLength(0);
  });

  it('refuses an update token, and says it was for updateFilter', async () => {
    box.filters = [{ id: 'OLD', criteria: { from: 'billing@vendor.test' }, action: { addLabelIds: ['Label_7'] } }];
    const token = await previewToken({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' });
    const out = await write(() => handleCreateFilter({ ...ARCHIVE_AND_LABEL, previewToken: token }, ACCOUNT));
    expect(out.text).toContain('came from a preview for manage_email.updateFilter');
    expect(box.filters).toHaveLength(1);
  });

  it('refuses when an identical filter appeared since the preview', async () => {
    const token = await previewToken(ARCHIVE_AND_LABEL);
    box.filters = [{ id: 'RACE', criteria: { from: 'billing@vendor.test' }, action: { addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] } }];
    const out = await write(() => handleCreateFilter({ ...ARCHIVE_AND_LABEL, previewToken: token }, ACCOUNT));
    expect(out.text).toContain('Filter RACE already does exactly this.');
    expect(box.filters).toHaveLength(1);
  });
});

describe('updateFilter', () => {
  beforeEach(() => {
    box.filters = [{ id: 'OLD', criteria: { from: 'billing@vendor.test' }, action: { addLabelIds: ['Label_7'] } }];
  });

  it('previews the replacement against the original', async () => {
    const out = await runAsToolCall(() => handlePreviewFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' }, ACCOUNT));
    expect(out.text).toContain('## Preview: replace filter OLD');
    expect(out.text).toContain('**Replaces** filter OLD');
    expect(out.text).toContain('call `updateFilter` with filterId OLD');
  });

  it('creates the replacement, then deletes the original', async () => {
    const token = await previewToken({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' });
    const out = await write(() => handleUpdateFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD', previewToken: token }, ACCOUNT));
    expect(out.refs).toMatchObject({ filterId: 'F1', replacedFilterId: 'OLD', originalDeleted: true });
    expect(box.filters.map((f) => f.id)).toEqual(['F1']);
  });

  it('refuses when the original changed after the preview', async () => {
    const token = await previewToken({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' });
    box.filters = [{ id: 'OLD', criteria: { from: 'billing@vendor.test' }, action: { addLabelIds: ['STARRED'] } }];
    const out = await write(() => handleUpdateFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD', previewToken: token }, ACCOUNT));
    expect(out.text).toContain('Not changed');
    expect(box.filters.map((f) => f.id)).toEqual(['OLD']);
  });

  it('fails, naming both filters, when the original cannot be deleted', async () => {
    const token = await previewToken({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' });
    box.deleteError = new Error('backend error');
    // Thrown, not returned: a queue with onError 'bail' must stop on a half-done update.
    await expect(write(() => handleUpdateFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD', previewToken: token }, ACCOUNT)))
      .rejects.toThrow(/half done: created the replacement filter F1.*could not delete the original OLD.*Both are active/);
    expect(box.filters.map((f) => f.id)).toEqual(['OLD', 'F1']);
  });

  it('succeeds when the original was already deleted', async () => {
    const token = await previewToken({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' });
    box.deleteError = notFound();
    const out = await write(() => handleUpdateFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD', previewToken: token }, ACCOUNT));
    expect(out.refs).toMatchObject({ filterId: 'F1', replacedFilterId: 'OLD', originalDeleted: true });
  });

  it('refuses a create token, and says it was for createFilter', async () => {
    const token = await previewToken({ ...ARCHIVE_AND_LABEL, matchFrom: 'other@vendor.test' });
    const out = await write(() => handleUpdateFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD', previewToken: token }, ACCOUNT));
    expect(out.text).toContain('came from a preview for manage_email.createFilter');
    expect(box.filters.map((f) => f.id)).toEqual(['OLD']);
  });

  it('is not offered at the filter limit, since the replacement is created first', async () => {
    box.filters = Array.from({ length: 1000 }, (_, i) => ({ id: i === 0 ? 'OLD' : `X${i}`, criteria: { from: `s${i}@x.test` }, action: { addLabelIds: ['Label_7'] } }));
    const out = await runAsToolCall(() => handlePreviewFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' }, ACCOUNT));
    expect(out.text).toContain('Delete OLD first');
    expect(out.refs?.previewToken).toBeUndefined();
  });

  it('refuses a filter that no longer exists', async () => {
    const token = await previewToken({ ...ARCHIVE_AND_LABEL, filterId: 'OLD' });
    box.filters = [];
    const out = await write(() => handleUpdateFilter({ ...ARCHIVE_AND_LABEL, filterId: 'OLD', previewToken: token }, ACCOUNT));
    expect(out.text).toContain('no longer exists');
    expect(box.filters).toHaveLength(0);
  });
});

describe('reading and deleting', () => {
  beforeEach(() => {
    box.filters = [{ id: 'F9', criteria: { from: 'billing@vendor.test' }, action: { addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] } }];
  });

  it('lists filters with what each does', async () => {
    const out = await handleListFilters({}, ACCOUNT);
    expect(out.text).toContain('## Filters (1 of 1,000)');
    expect(out.text).toContain('F9 | from:(billing@vendor.test) | labeled "Vendor/Billing"; skips the inbox');
  });

  it('gets one filter with the parameters that recreate it', async () => {
    const out = await handleGetFilter({ filterId: 'F9' }, ACCOUNT);
    expect(out.refs?.params).toEqual({ matchFrom: 'billing@vendor.test', addLabelIds: 'Label_7', removeLabelIds: 'INBOX' });
    expect((await handleGetFilter({ filterId: 'nope' }, ACCOUNT)).text).toContain('No filter nope');
  });

  it('deletes without a preview, and returns what it removed', async () => {
    const out = await handleDeleteFilter({ filterId: 'F9' }, ACCOUNT);
    expect(out.refs).toMatchObject({ filterId: 'F9', deleted: true, params: { matchFrom: 'billing@vendor.test' } });
    expect(box.filters).toHaveLength(0);
  });

  it('round-trips: the parameters a delete returns preview and create the same filter', async () => {
    const deleted = await handleDeleteFilter({ filterId: 'F9' }, ACCOUNT);
    const params = deleted.refs?.params as Record<string, unknown>;
    const token = await previewToken(params);
    await write(() => handleCreateFilter({ ...params, previewToken: token }, ACCOUNT));
    expect(box.filters[0]).toMatchObject({
      criteria: { from: 'billing@vendor.test' },
      action: { addLabelIds: ['Label_7'], removeLabelIds: ['INBOX'] },
    });
  });
});
