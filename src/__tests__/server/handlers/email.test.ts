import { vi, beforeEach, describe, expect, it } from 'vitest';

// Registered here, not in the shared helper: vi.mock hoists per-file.
// BOTH seams are mocked (ADR-103): `search`/`read` are resource ops and go
// through the client; `triage` and `send` are still gws helpers (+triage/+send)
// and go through execute().
vi.mock('../../../executor/gws.js');
vi.mock('../../../google/client.js');
import { mockExecute, mockGwsResponse, gmailTriageResponse } from './__mocks__/executor.js';
import { mockCall } from './__mocks__/client.js';
import {
  gmailMessageDetailResponse, gmailSendResponse, gmailMessageListResponse,
  gmailMetadataResponse,
} from './__mocks__/fixtures.js';
import { handleEmail } from '../../../server/handlers/email.js';

describe('handleEmail', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCall.mockReset();
  });

  it('rejects missing email', async () => {
    await expect(handleEmail({ operation: 'triage' })).rejects.toThrow('valid email');
  });

  it('rejects invalid email format', async () => {
    await expect(handleEmail({ operation: 'triage', email: '../etc/passwd' })).rejects.toThrow('valid email');
  });

  describe('triage', () => {
    it('calls gws gmail +triage and returns markdown with messages', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(gmailTriageResponse));
      const result = await handleEmail({ operation: 'triage', email: 'user@test.com' });

      expect(result.text).toContain('## Messages (2)');
      expect(result.text).toContain('alice@test.com');
      expect(result.text).toContain('**Next steps:**');
      expect(result.refs.count).toBe(2);
      expect(mockExecute).toHaveBeenCalledWith(['gmail', '+triage'], expect.objectContaining({ account: 'user@test.com' }));
    });
  });

  describe('search', () => {
    it('passes the query to users.messages.list and hydrates results with metadata', async () => {
      // First call: messages.list returns IDs only
      // Subsequent calls: messages.get with format=metadata for each ID
      mockCall
        .mockResolvedValueOnce(gmailMessageListResponse)
        .mockResolvedValueOnce(gmailMetadataResponse('msg-1', 'alice@test.com', 'Hello', 'Mon, 10 Mar 2026'))
        .mockResolvedValueOnce(gmailMetadataResponse('msg-2', 'bob@test.com', 'Meeting', 'Mon, 10 Mar 2026'));

      const result = await handleEmail({ operation: 'search', email: 'user@test.com', query: 'from:alice' });

      // The list call: `query` maps to `q`, and userId defaults to `me`.
      expect(mockCall).toHaveBeenNthCalledWith(
        1,
        'gmail',
        'users.messages.list',
        expect.objectContaining({ q: 'from:alice', userId: 'me' }),
        expect.objectContaining({ account: 'user@test.com' }),
      );

      // The hydration calls: messages.get with format=metadata.
      expect(mockCall).toHaveBeenNthCalledWith(
        2,
        'gmail',
        'users.messages.get',
        expect.objectContaining({ userId: 'me', id: 'msg-1', format: 'metadata' }),
        expect.objectContaining({ account: 'user@test.com' }),
      );

      // Verify formatted output has actual content
      expect(result.text).toContain('alice@test.com');
      expect(result.text).toContain('Hello');
      expect(result.refs.count).toBe(2);
    });

    it('clamps maxResults to 50', async () => {
      mockCall.mockResolvedValueOnce({ messages: [] });
      await handleEmail({ operation: 'search', email: 'user@test.com', maxResults: 200 });

      expect(mockCall.mock.calls[0][2].maxResults).toBe(50);
    });

    it('handles empty search results without hydration calls', async () => {
      mockCall.mockResolvedValueOnce({ messages: [], resultSizeEstimate: 0 });

      const result = await handleEmail({ operation: 'search', email: 'user@test.com', query: 'nonexistent' });

      expect(mockCall).toHaveBeenCalledTimes(1); // only the list call
      expect(result.text).toContain('No messages found');
    });
  });

  describe('read', () => {
    it('requires messageId', async () => {
      await expect(handleEmail({ operation: 'read', email: 'user@test.com' })).rejects.toThrow('messageId');
    });

    it('returns markdown email detail', async () => {
      mockCall.mockResolvedValue(gmailMessageDetailResponse);
      const result = await handleEmail({ operation: 'read', email: 'user@test.com', messageId: 'msg-1' });

      expect(mockCall).toHaveBeenCalledWith(
        'gmail',
        'users.messages.get',
        expect.objectContaining({ id: 'msg-1', userId: 'me' }),
        expect.objectContaining({ account: 'user@test.com' }),
      );
      expect(result.text).toContain('## Test Subject');
      expect(result.text).toContain('**From:** alice@test.com');
      expect(result.refs.from).toBe('alice@test.com');
      expect(result.refs.subject).toBe('Test Subject');
    });
  });

  describe('send', () => {
    it('requires to, subject, body', async () => {
      await expect(handleEmail({ operation: 'send', email: 'user@test.com' })).rejects.toThrow('to');
      await expect(handleEmail({ operation: 'send', email: 'user@test.com', to: 'a@b.com' })).rejects.toThrow('subject');
      await expect(handleEmail({ operation: 'send', email: 'user@test.com', to: 'a@b.com', subject: 'Hi' })).rejects.toThrow('body');
    });

    it('calls gws gmail +send with correct args', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(gmailSendResponse));
      const result = await handleEmail({ operation: 'send', email: 'user@test.com', to: 'bob@test.com', subject: 'Hi', body: 'Hello' });

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('+send');
      expect(args[args.indexOf('--to') + 1]).toBe('bob@test.com');
      expect(result.text).toContain('Email sent to bob@test.com');
      expect(result.refs.to).toBe('bob@test.com');
    });
  });

  describe('reply', () => {
    it('requires messageId and body', async () => {
      await expect(handleEmail({ operation: 'reply', email: 'user@test.com' })).rejects.toThrow('messageId');
      await expect(handleEmail({ operation: 'reply', email: 'user@test.com', messageId: 'x' })).rejects.toThrow('body');
    });
  });

  it('rejects unknown operation', async () => {
    await expect(handleEmail({ operation: 'explode', email: 'user@test.com' })).rejects.toThrow('Unknown');
  });
});
