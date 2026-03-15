import {
  mockExecute, mockGwsResponse,
  gmailTriageResponse, gmailMessageDetailResponse, gmailSendResponse, gmailMessageListResponse,
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
    it('calls gws gmail +triage and returns formatted list', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(gmailTriageResponse));
      const result = await handleEmail({ operation: 'triage', email: 'user@test.com' }) as any;

      expect(result.emails).toHaveLength(2);
      expect(result.emails[0].from).toBe('alice@test.com');
      expect(result.next_steps).toBeDefined();
      expect(mockExecute).toHaveBeenCalledWith(['gmail', '+triage'], expect.objectContaining({ account: 'user@test.com' }));
    });
  });

  describe('search', () => {
    it('passes query to gws', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(gmailMessageListResponse));
      await handleEmail({ operation: 'search', email: 'user@test.com', query: 'from:alice' });

      const args = mockExecute.mock.calls[0][0];
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.q).toBe('from:alice');
      expect(params.userId).toBe('me');
    });

    it('clamps maxResults to 50', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(gmailMessageListResponse));
      await handleEmail({ operation: 'search', email: 'user@test.com', maxResults: 200 });

      const args = mockExecute.mock.calls[0][0];
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      expect(params.maxResults).toBe(50);
    });
  });

  describe('read', () => {
    it('requires messageId', async () => {
      await expect(handleEmail({ operation: 'read', email: 'user@test.com' })).rejects.toThrow('messageId');
    });

    it('returns formatted email detail', async () => {
      mockExecute.mockResolvedValue(mockGwsResponse(gmailMessageDetailResponse));
      const result = await handleEmail({ operation: 'read', email: 'user@test.com', messageId: 'msg-1' }) as any;

      expect(result.from).toBe('alice@test.com');
      expect(result.subject).toBe('Test Subject');
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
      await handleEmail({ operation: 'send', email: 'user@test.com', to: 'bob@test.com', subject: 'Hi', body: 'Hello' });

      const args = mockExecute.mock.calls[0][0];
      expect(args).toContain('+send');
      expect(args[args.indexOf('--to') + 1]).toBe('bob@test.com');
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
