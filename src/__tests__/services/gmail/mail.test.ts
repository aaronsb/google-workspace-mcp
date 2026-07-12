/**
 * Outbound mail: threading, recipients, and the reply-all rules.
 *
 * These are worth testing precisely because they are the kind of thing that is
 * WRONG SILENTLY: a forward that breaks a thread, or a reply-all that mails you
 * your own reply, produces no error — it just looks stupid in someone else's
 * inbox.
 *
 * The forward-threading test exists because it was got WRONG once, on a confident
 * but invented belief that Gmail starts a new thread on forward. It does not.
 * See the header comment in src/services/gmail/mail.ts.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../../google/client.js');
import { call, upload } from '../../../google/client.js';
import { replyMail, forwardMail } from '../../../services/gmail/mail.js';

const mockCall = call as MockedFunction<typeof call>;
const mockUpload = upload as MockedFunction<typeof upload>;

const ACCOUNT = 'me@test.com';
const ORIGINAL_MESSAGE_ID = '<original-abc@mail.test.com>';
const ORIGINAL_THREAD = 'thread-123';

/** A message from someone else, addressed to us and two other people. */
function originalMessage(from = 'alice@test.com') {
  return {
    id: 'msg-1',
    threadId: ORIGINAL_THREAD,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Message-ID', value: ORIGINAL_MESSAGE_ID },
        { name: 'References', value: '<older-1@mail.test.com>' },
        { name: 'Subject', value: 'Quarterly numbers' },
        { name: 'From', value: from },
        { name: 'To', value: `${ACCOUNT}, bob@test.com` },
        { name: 'Cc', value: 'carol@test.com' },
        { name: 'Date', value: 'Mon, 6 Jul 2026 10:00:00 -0500' },
      ],
      body: { data: Buffer.from('the original body').toString('base64url') },
    },
  };
}

/** The RFC 5322 bytes we actually handed to Google. */
function sentMessage(): string {
  return (mockUpload.mock.calls[0][3] as { media: Buffer }).media.toString('utf-8');
}

/** The upload metadata — this is where threadId rides. */
function sentMetadata(): Record<string, unknown> {
  return (mockUpload.mock.calls[0][3] as { metadata: Record<string, unknown> }).metadata;
}

const headerLine = (msg: string, name: string): string => {
  const match = msg.split('\r\n\r\n')[0]
    .split('\r\n')
    .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return match ? match.slice(name.length + 1).trim() : '';
};

beforeEach(() => {
  mockCall.mockReset();
  mockUpload.mockReset();
  mockUpload.mockResolvedValue({ id: 'sent-1', threadId: ORIGINAL_THREAD });
});

describe('forwardMail', () => {
  it('THREADS the forward — In-Reply-To, References, and the original threadId', async () => {
    // This is the regression. A forward is a continuation of the message's
    // identity, not a new conversation, and every real client behaves this way:
    // checked against live mail, forwards from Gmail, Outlook/Exchange and Yahoo
    // all carry In-Reply-To + References, and Gmail binds them to the original
    // thread. An earlier version of forwardMail deliberately did NOT thread, on a
    // belief that was simply invented.
    mockCall.mockResolvedValue(originalMessage());

    await forwardMail(ACCOUNT, { messageId: 'msg-1', to: 'dave@test.com', includeAttachments: false });

    const msg = sentMessage();
    expect(headerLine(msg, 'In-Reply-To')).toBe(ORIGINAL_MESSAGE_ID);
    // References carries the CHAIN, not just the parent, or clients cannot rebuild the tree.
    expect(headerLine(msg, 'References')).toContain('<older-1@mail.test.com>');
    expect(headerLine(msg, 'References')).toContain(ORIGINAL_MESSAGE_ID);
    // …and Gmail's own thread binding.
    expect(sentMetadata()).toMatchObject({ threadId: ORIGINAL_THREAD });
  });

  it('prefixes Fwd: once, not twice', async () => {
    mockCall.mockResolvedValue({
      ...originalMessage(),
      payload: {
        ...originalMessage().payload,
        headers: [
          ...originalMessage().payload.headers.filter((h) => h.name !== 'Subject'),
          { name: 'Subject', value: 'Fwd: Quarterly numbers' },
        ],
      },
    });

    await forwardMail(ACCOUNT, { messageId: 'msg-1', to: 'dave@test.com', includeAttachments: false });
    expect(headerLine(sentMessage(), 'Subject')).toBe('Fwd: Quarterly numbers');
  });
});

describe('replyMail', () => {
  it('threads the reply and prefixes Re: once', async () => {
    mockCall.mockResolvedValue(originalMessage());

    await replyMail(ACCOUNT, { messageId: 'msg-1', body: 'ack' });

    const msg = sentMessage();
    expect(headerLine(msg, 'Subject')).toBe('Re: Quarterly numbers');
    expect(headerLine(msg, 'In-Reply-To')).toBe(ORIGINAL_MESSAGE_ID);
    expect(sentMetadata()).toMatchObject({ threadId: ORIGINAL_THREAD });
  });

  it('reply goes ONLY to the sender — not to everyone on the thread', async () => {
    mockCall.mockResolvedValue(originalMessage());

    await replyMail(ACCOUNT, { messageId: 'msg-1', body: 'ack' });

    const msg = sentMessage();
    expect(headerLine(msg, 'To')).toBe('alice@test.com');
    expect(msg).not.toContain('bob@test.com');      // a plain reply must not fan out
    expect(msg).not.toContain('carol@test.com');
  });

  it('reply-all keeps the sender in To, moves everyone else to Cc, and EXCLUDES you', async () => {
    mockCall.mockResolvedValue(originalMessage());

    await replyMail(ACCOUNT, { messageId: 'msg-1', body: 'ack', all: true });

    const msg = sentMessage();
    expect(headerLine(msg, 'To')).toBe('alice@test.com');

    const cc = headerLine(msg, 'Cc');
    expect(cc).toContain('bob@test.com');
    expect(cc).toContain('carol@test.com');
    // The bug this guards: mailing yourself a copy of your own reply, visibly, in
    // the Cc line. Your own address must never survive.
    expect(cc).not.toContain(ACCOUNT);
    expect(headerLine(msg, 'To')).not.toContain(ACCOUNT);
  });

  it('reply-all to your OWN message reaches the people you originally wrote to', async () => {
    // Replying-all to a message YOU sent: the sender is you, so "reply to the
    // sender" would mail yourself and nobody else. The people to reach are the
    // original recipients. Gmail behaves this way; so do we.
    mockCall.mockResolvedValue(originalMessage(ACCOUNT));

    await replyMail(ACCOUNT, { messageId: 'msg-1', body: 'following up', all: true });

    const msg = sentMessage();
    expect(headerLine(msg, 'To')).toBe('bob@test.com');       // ACCOUNT stripped from the original To
    expect(headerLine(msg, 'Cc')).toContain('carol@test.com');
    expect(msg).not.toContain(`To: ${ACCOUNT}`);
  });

  it('refuses to send a reply that would reach nobody', async () => {
    // A message from yourself, to yourself. After excluding your own address there
    // is no recipient left. Silently sending a message to nobody is worse than
    // failing.
    mockCall.mockResolvedValue({
      ...originalMessage(ACCOUNT),
      payload: {
        ...originalMessage(ACCOUNT).payload,
        headers: [
          ...originalMessage(ACCOUNT).payload.headers.filter((h) => h.name !== 'To' && h.name !== 'Cc'),
          { name: 'To', value: ACCOUNT },
        ],
      },
    });

    await expect(
      replyMail(ACCOUNT, { messageId: 'msg-1', body: 'hi', all: true }),
    ).rejects.toThrow(/no recipient/i);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('an address in both To and Cc survives only in To', async () => {
    mockCall.mockResolvedValue(originalMessage());

    // alice is the sender (so she lands in To); adding her to --cc must not
    // duplicate her — she would receive the mail twice and appear on both lines.
    await replyMail(ACCOUNT, { messageId: 'msg-1', body: 'ack', all: true, cc: 'alice@test.com' });

    const msg = sentMessage();
    expect(headerLine(msg, 'To')).toBe('alice@test.com');
    expect(headerLine(msg, 'Cc')).not.toContain('alice@test.com');
  });
});
