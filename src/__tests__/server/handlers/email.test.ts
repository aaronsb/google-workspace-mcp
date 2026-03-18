import {
  mockExecute, mockGwsResponse,
  gmailTriageResponse, gmailMessageDetailResponse, gmailSendResponse, gmailMessageListResponse,
  gmailMetadataResponse,
} from './__mocks__/executor.js';
import { handleEmail } from '../../../server/handlers/email.js';

describe('handleEmail', () => {
  beforeEach(() => mockExecute.mockReset());

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
    it('passes query to gws and hydrates results with metadata', async () => {
      // First call: messages.list returns IDs only
      // Subsequent calls: messages.get with format=metadata for each ID
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse(gmailMessageListResponse))
        .mockResolvedValueOnce(mockGwsResponse(gmailMetadataResponse('msg-1', 'alice@test.com', 'Hello', 'Mon, 10 Mar 2026')))
        .mockResolvedValueOnce(mockGwsResponse(gmailMetadataResponse('msg-2', 'bob@test.com', 'Meeting', 'Mon, 10 Mar 2026')));

      const result = await handleEmail({ operation: 'search', email: 'user@test.com', query: 'from:alice' });

      // Verify list call
      const listArgs = mockExecute.mock.calls[0][0];
      const listParams = JSON.parse(listArgs[listArgs.indexOf('--params') + 1]);
      expect(listParams.q).toBe('from:alice');
      expect(listParams.userId).toBe('me');

      // Verify hydration calls used metadata format
      const getArgs = mockExecute.mock.calls[1][0];
      const getParams = JSON.parse(getArgs[getArgs.indexOf('--params') + 1]);
      expect(getParams.format).toBe('metadata');

      // Verify formatted output has actual content
      expect(result.text).toContain('alice@test.com');
      expect(result.text).toContain('Hello');
      expect(result.refs.count).toBe(2);
    });

    it('clamps maxResults to 50', async () => {
      mockExecute
        .mockResolvedValueOnce(mockGwsResponse({ messages: [] }));
      await handleEmail({ operation: 'search', email: 'user@test.com', maxResults: 200 });

      const args = mockExecute.mock.calls[0][0];
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.maxResults).toBe(50);
    });

    it('handles empty search results without hydration calls', async () => {
      mockExecute.mockResolvedValueOnce(mockGwsResponse({ messages: [] }));

      const result = await handleEmail({ operation: 'search', email: 'user@test.com', query: 'nonexistent' });

      expect(mockExecute).toHaveBeenCalledTimes(1); // only the list call
      expect(result.text).toContain('No messages found');
    });
  });

  describe('read', () => {
    it('requires messageId', async () => {
      await expect(handleEmail({ operation: 'read', email: 'user@test.com' })).rejects.toThrow('messageId');
    });

    it('returns markdown email detail', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(gmailMessageDetailResponse));
      const result = await handleEmail({ operation: 'read', email: 'user@test.com', messageId: 'msg-1' });

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
