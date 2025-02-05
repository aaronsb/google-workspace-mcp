import { GmailService } from '../../../modules/gmail/service.js';
import { gmail_v1 } from 'googleapis';
import { getAccountManager } from '../../../modules/accounts/index.js';
import { AccountManager } from '../../../modules/accounts/manager.js';

jest.mock('../../../modules/accounts/index.js');
jest.mock('../../../modules/accounts/manager.js');

describe('GmailService', () => {
  let gmailService: GmailService;
  let mockGmailClient: jest.Mocked<gmail_v1.Gmail>;
  let mockAccountManager: jest.Mocked<AccountManager>;

  const mockEmail = 'test@example.com';

  beforeEach(() => {
    mockGmailClient = {
      users: {
        messages: {
          list: jest.fn(() => Promise.resolve({ data: {} })),
          get: jest.fn(() => Promise.resolve({ data: {} })),
          send: jest.fn(() => Promise.resolve({ data: {} })),
        },
        getProfile: jest.fn(() => Promise.resolve({ data: {} })),
        settings: {
          getAutoForwarding: jest.fn(() => Promise.resolve({ data: {} })),
          getImap: jest.fn(() => Promise.resolve({ data: {} })),
          getLanguage: jest.fn(() => Promise.resolve({ data: {} })),
          getPop: jest.fn(() => Promise.resolve({ data: {} })),
          getVacation: jest.fn(() => Promise.resolve({ data: {} })),
        },
      },
    } as any;

    mockAccountManager = {
      validateToken: jest.fn().mockResolvedValue({ valid: true, token: {} }),
      getAuthClient: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<AccountManager>;

    (getAccountManager as jest.Mock).mockReturnValue(mockAccountManager);

    gmailService = new GmailService();
    (gmailService as any).getGmailClient = jest.fn().mockResolvedValue(mockGmailClient);
  });

  describe('getEmails', () => {
    const mockSearchParams = {
      from: 'sender@example.com',
      subject: 'Test Subject',
      after: '2024-01-01',
    };

    const mockMessageList = {
      data: {
        messages: [
          { id: 'msg1', threadId: 'thread1' },
          { id: 'msg2', threadId: 'thread2' },
        ],
        resultSizeEstimate: 2,
      },
    };

    const mockMessage = {
      data: {
        id: 'msg1',
        threadId: 'thread1',
        labelIds: ['INBOX'],
        snippet: 'Email snippet',
        payload: {
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'To', value: 'recipient@example.com' },
            { name: 'Date', value: '2024-01-01T00:00:00Z' },
          ],
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: Buffer.from('Test content').toString('base64') },
            },
          ],
        },
      },
    };

    it('should get emails with given criteria', async () => {
      (mockGmailClient.users.messages.list as any).mockResolvedValue(mockMessageList);
      (mockGmailClient.users.messages.get as any).mockResolvedValue(mockMessage);

      const result = await gmailService.getEmails({
        email: mockEmail,
        search: mockSearchParams,
      });

      expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: expect.any(String),
        maxResults: expect.any(Number),
      });

      expect(result.emails.length).toBeGreaterThan(0);
      expect(result.emails[0]).toHaveProperty('id');
      expect(result.emails[0]).toHaveProperty('subject');
      expect(result.emails[0]).toHaveProperty('from');
      expect(result.resultSummary.total).toBe(2);
    });

    it('should handle empty results', async () => {
      (mockGmailClient.users.messages.list as any).mockResolvedValue({ data: {} });

      const result = await gmailService.getEmails({
        email: mockEmail,
        search: mockSearchParams,
      });

      expect(result.emails).toEqual([]);
      expect(result.resultSummary.total).toBe(0);
    });
  });

  describe('sendEmail', () => {
    const mockEmailParams = {
      email: mockEmail,
      to: ['recipient@example.com'],
      subject: 'Test Email',
      body: 'Hello, World!',
    };

    it('should send email successfully', async () => {
      const mockSendResponse = {
        data: {
          id: 'sent-msg-1',
          threadId: 'thread1',
          labelIds: ['SENT'],
        },
      };

      (mockGmailClient.users.messages.send as any).mockResolvedValue(mockSendResponse);

      const result = await gmailService.sendEmail(mockEmailParams);

      expect(result).toEqual({
        messageId: 'sent-msg-1',
        threadId: 'thread1',
        labelIds: ['SENT'],
      });

      expect(mockGmailClient.users.messages.send).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: expect.objectContaining({
          raw: expect.any(String),
        }),
      });
    });

    it('should handle send failure', async () => {
      (mockGmailClient.users.messages.send as any).mockRejectedValue(new Error('Send failed'));

      await expect(gmailService.sendEmail(mockEmailParams)).rejects.toThrow();
    });
  });

  describe('getWorkspaceGmailSettings', () => {
    it('should fetch Gmail settings', async () => {
      const mockProfile = {
        data: {
          emailAddress: mockEmail,
          messagesTotal: 1000,
          threadsTotal: 500,
          historyId: 'history1',
        },
      };

      const mockSettings = {
        data: {
          enabled: true,
        },
      };

      (mockGmailClient.users.getProfile as any).mockResolvedValue(mockProfile);
      (mockGmailClient.users.settings.getAutoForwarding as any).mockResolvedValue(mockSettings);
      (mockGmailClient.users.settings.getImap as any).mockResolvedValue(mockSettings);
      (mockGmailClient.users.settings.getLanguage as any).mockResolvedValue({ data: { displayLanguage: 'en' } });
      (mockGmailClient.users.settings.getPop as any).mockResolvedValue(mockSettings);
      (mockGmailClient.users.settings.getVacation as any).mockResolvedValue(mockSettings);

      const result = await gmailService.getWorkspaceGmailSettings({ email: mockEmail });

      expect(result.profile.emailAddress).toBe(mockEmail);
      expect(result.settings).toBeDefined();
      expect(mockGmailClient.users.getProfile).toHaveBeenCalledWith({
        userId: 'me',
      });
    });

    it('should handle settings fetch failure', async () => {
      (mockGmailClient.users.getProfile as any).mockRejectedValue(new Error('Fetch failed'));

      await expect(
        gmailService.getWorkspaceGmailSettings({ email: mockEmail })
      ).rejects.toThrow();
    });
  });
});
