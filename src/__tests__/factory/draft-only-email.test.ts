import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

// The Google API client is the one seam (ADR-103): what reaches it decides whether
// mail was sent or drafted. The policy, the generated handler, the Gmail patch and
// the mail helper all run for real.
vi.mock('../../google/client.js');
// queue.js imports handler.js for the epoch counter; stub just that, as queue.test.ts does.
vi.mock('../../server/handler.js', () => ({
  advanceEpoch: vi.fn(() => 1),
  getEpoch: vi.fn(() => 1),
}));

import { call, upload } from '../../google/client.js';
import { loadManifest, generateHandler, generateSchema } from '../../factory/generator.js';
import { patches } from '../../factory/patches.js';
import { configurePolicies, draftOnlyEmail } from '../../factory/safety.js';
import { handleQueue } from '../../server/queue.js';

const mockCall = call as MockedFunction<typeof call>;
const mockUpload = upload as MockedFunction<typeof upload>;

const manifest = loadManifest();
const gmail = () => generateHandler(manifest.services.gmail, patches.gmail);

/** The message being replied to or forwarded — fetched to build headers and quote it. */
const original = {
  id: 'msg-1',
  threadId: 'thread-1',
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'Message-ID', value: '<orig@mail.test>' },
      { name: 'Subject', value: 'Budget' },
      { name: 'From', value: 'alice@t.com' },
      { name: 'To', value: 'u@t.com, bob@t.com' },
      { name: 'Date', value: 'Mon, 10 Mar 2026 10:00:00 -0500' },
    ],
    body: { data: Buffer.from('original body', 'utf-8').toString('base64url') },
  },
};

const args: Record<string, Record<string, unknown>> = {
  send: { operation: 'send', email: 'u@t.com', to: 'bob@t.com', subject: 'hi', body: 'hello' },
  reply: { operation: 'reply', email: 'u@t.com', messageId: 'msg-1', body: 'thanks' },
  replyAll: { operation: 'replyAll', email: 'u@t.com', messageId: 'msg-1', body: 'thanks all' },
  forward: { operation: 'forward', email: 'u@t.com', messageId: 'msg-1', to: 'carol@t.com', body: 'fyi' },
};

/** The [resource, metadata] of the single upload the handler made. */
function delivered(): [string, Record<string, unknown>] {
  expect(mockUpload).toHaveBeenCalledTimes(1);
  const [, resource, , opts] = mockUpload.mock.calls[0];
  return [resource as string, (opts as { metadata: Record<string, unknown> }).metadata];
}

beforeEach(() => {
  mockCall.mockReset();
  mockUpload.mockReset();
  mockCall.mockResolvedValue(original);
  mockUpload.mockResolvedValue({ id: 'draft-1', message: { id: 'm-2', threadId: 'thread-1' } });
});

describe('draft-only-email lets drafts through and nothing else (#214)', () => {
  beforeEach(() => configurePolicies([draftOnlyEmail]));
  afterEach(() => configurePolicies([]));

  it.each(['send', 'reply', 'replyAll', 'forward'])('%s with draft saves a draft and never sends', async (op) => {
    for (const draft of [true, 'true']) {
      mockUpload.mockClear();
      const result = await gmail()({ ...args[op], draft });

      expect(result.refs?.blocked, `${op} draft=${JSON.stringify(draft)}`).toBeUndefined();
      const [resource, metadata] = delivered();
      expect(resource).toBe('users.drafts.create');
      expect(result.refs).toMatchObject({ draftId: 'draft-1', isDraft: true });
      // Replies and forwards stay in the conversation they answer.
      if (op !== 'send') expect(metadata).toEqual({ message: { threadId: 'thread-1' } });
    }
  });

  it.each(['send', 'reply', 'replyAll', 'forward'])('%s that would send is refused before Google is called', async (op) => {
    for (const extra of [{}, { draft: false }, { draft: 'false' }, { draft: 1 }]) {
      const result = await gmail()({ ...args[op], ...extra });

      expect(result.refs?.blocked, `${op} ${JSON.stringify(extra)}`).toBe(true);
      expect(result.text).toContain('draft: true');
    }
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('a draft flag that arrives as a $N reference in a queue still saves a draft', async () => {
    // Queue references stringify: a boolean true in an earlier result becomes 'true'.
    const handlers = {
      flag: async () => ({ text: 'flag', refs: { yes: true, no: false } }),
      manage_email: gmail(),
    };

    const ok = await handleQueue({
      operations: [
        { tool: 'flag', args: {} },
        { tool: 'manage_email', args: { ...args.reply, draft: '$0.yes' } },
      ],
    }, handlers, 1);
    expect(ok.text).not.toMatch(/blocked/i);
    expect(delivered()[0]).toBe('users.drafts.create');

    mockUpload.mockClear();
    const refused = await handleQueue({
      operations: [
        { tool: 'flag', args: {} },
        { tool: 'manage_email', args: { ...args.reply, draft: '$0.no' } },
      ],
    }, handlers, 1);
    expect(refused.text).toMatch(/blocked/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('forward reports a draft as a draft', () => {
  it('says the forward was saved, not sent, when draft is set', async () => {
    const result = await gmail()({ ...args.forward, draft: true });

    expect(result.text).toContain('Draft forward to carol@t.com saved');
    expect(result.text).not.toContain('forwarded');
    expect(result.refs).toEqual({ id: 'draft-1', draftId: 'draft-1', messageId: 'msg-1', to: 'carol@t.com', isDraft: true });
  });

  it('keeps the live forward response unchanged', async () => {
    mockUpload.mockResolvedValue({ id: 'sent-1', threadId: 'thread-1' });
    const result = await gmail()(args.forward);

    expect(delivered()[0]).toBe('users.messages.send');
    expect(result.text).toContain('Message forwarded to carol@t.com');
    expect(result.refs).toEqual({ id: 'sent-1', threadId: 'thread-1', messageId: 'msg-1', to: 'carol@t.com' });
  });

  it('declares draft on forward, so the schema advertises forward drafts', () => {
    expect(manifest.services.gmail.operations.forward.params?.draft?.type).toBe('boolean');
    const properties = generateSchema(manifest.services.gmail).inputSchema.properties as Record<string, { type: string }>;
    expect(properties.draft.type).toBe('boolean');
  });
});
