import { GmailService } from '../../../modules/gmail/service.js';
import { gmail_v1 } from 'googleapis';
import { getAccountManager } from '../../../modules/accounts/index.js';
import { AccountManager } from '../../../modules/accounts/manager.js';
import { DraftResponse, GetDraftsResponse, SendEmailResponse } from '../../../modules/gmail/types.js';

jest.mock('../../../modules/accounts/index.js');
jest.mock('../../../modules/accounts/manager.js');

describe('GmailService', () => {
  let gmailService: GmailService;
  let mockGmailClient: jest.Mocked<gmail_v1.Gmail>;
  let mockAccountManager: jest.Mocked<AccountManager>;
  const testEmail = 'test@example.com';

  beforeEach(async () => {
    // Simplified mock setup
    mockGmailClient = {
      users: {
        messages: {
          list: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          get: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          send: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
        },
        drafts: {
          create: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          list: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          get: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          send: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
        },
        getProfile: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
        settings: {
          getAutoForwarding: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          getImap: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          getLanguage: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          getPop: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
          getVacation: jest.fn().mockImplementation(() => Promise.resolve({ data: {} })),
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
    await gmailService.init();
  });

  describe('getEmails', () => {
    it('should get emails with search criteria', async () => {
      const mockMessages = [
        { id: 'msg1', threadId: 'thread1' },
        { id: 'msg2', threadId: 'thread2' }
      ];

      (mockGmailClient.users.messages.list as jest.Mock).mockImplementation(() =>
        Promise.resolve({ data: { messages: mockMessages, resultSizeEstimate: 2 } })
      );

      const result = await gmailService.getEmails({
        email: testEmail,
        search: { subject: 'test' }
      });

      expect(result.emails.length).toBe(2);
      expect(result.resultSummary.total).toBe(2);
    });

    it('should handle empty results', async () => {
      (mockGmailClient.users.messages.list as jest.Mock).mockImplementation(() =>
        Promise.resolve({ data: { messages: [], resultSizeEstimate: 0 } })
      );

      const result = await gmailService.getEmails({ email: testEmail });
      expect(result.emails).toEqual([]);
      expect(result.resultSummary.total).toBe(0);
    });
  });

  describe('sendEmail', () => {
    const emailParams = {
      email: testEmail,
      to: ['recipient@example.com'],
      subject: 'Test',
      body: 'Hello'
    };

    it('should send email', async () => {
      (mockGmailClient.users.messages.send as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: { id: 'msg1', threadId: 'thread1', labelIds: ['SENT'] }
        })
      );

      const result = await gmailService.sendEmail(emailParams);
      expect(result.messageId).toBe('msg1');
      expect(result.labelIds).toContain('SENT');
    });

    it('should handle send failure', async () => {
      (mockGmailClient.users.messages.send as jest.Mock).mockImplementation(() =>
        Promise.reject(new Error('Send failed'))
      );

      await expect(gmailService.sendEmail(emailParams)).rejects.toThrow();
    });
  });

  describe('manageDraft', () => {
    it('should create draft', async () => {
      (mockGmailClient.users.drafts.create as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: {
            id: 'draft1',
            message: { id: 'msg1' }
          }
        })
      );

      const result = await gmailService.manageDraft({
        action: 'create',
        email: testEmail,
        data: {
          to: ['test@example.com'],
          subject: 'Draft',
          body: 'Content'
        }
      }) as DraftResponse;

      expect(result).toHaveProperty('id', 'draft1');
    });

    it('should list drafts', async () => {
      (mockGmailClient.users.drafts.list as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: {
            drafts: [{ id: 'draft1' }, { id: 'draft2' }],
            resultSizeEstimate: 2
          }
        })
      );

      const result = await gmailService.manageDraft({
        action: 'read',
        email: testEmail
      }) as GetDraftsResponse;

      expect(result).toHaveProperty('drafts');
      expect(result.drafts.length).toBe(2);
    });

    it('should send draft', async () => {
      (mockGmailClient.users.drafts.send as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: {
            id: 'msg1',
            threadId: 'thread1',
            labelIds: ['SENT']
          }
        })
      );

      const result = await gmailService.manageDraft({
        action: 'send',
        email: testEmail,
        draftId: 'draft1'
      }) as SendEmailResponse;

      expect(result).toHaveProperty('messageId', 'msg1');
      expect(result).toHaveProperty('labelIds');
    });
  });

  describe('getWorkspaceGmailSettings', () => {
    it('should get settings', async () => {
      (mockGmailClient.users.getProfile as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          data: {
            emailAddress: testEmail,
            messagesTotal: 100
          }
        })
      );

      const result = await gmailService.getWorkspaceGmailSettings({
        email: testEmail
      });

      expect(result.profile.emailAddress).toBe(testEmail);
      expect(result.settings).toBeDefined();
    });

    it('should handle settings fetch error', async () => {
      (mockGmailClient.users.getProfile as jest.Mock).mockImplementation(() =>
        Promise.reject(new Error('Failed to fetch'))
      );

      await expect(gmailService.getWorkspaceGmailSettings({
        email: testEmail
      })).rejects.toThrow();
    });
  });
});
