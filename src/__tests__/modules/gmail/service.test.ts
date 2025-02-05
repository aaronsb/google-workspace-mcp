import { GmailService } from '../../../modules/gmail/service.js';
import { mockGmailResponses } from '../../../__fixtures__/accounts.js';
import { setupTestEnvironment } from '../../../__helpers__/testSetup.js';
import { getAccountManager } from '../../../modules/accounts/index.js';

jest.mock('../../../modules/accounts/index.js');

describe('GmailService', () => {
  const { accountManager: mocks, gmailClient: mockGmailClient } = setupTestEnvironment();
  let gmailService: GmailService;
  const testEmail = 'test@example.com';

  beforeEach(() => {
    (getAccountManager as jest.Mock).mockReturnValue(mocks);
    gmailService = new GmailService();
    (gmailService as any).getGmailClient = jest.fn().mockResolvedValue(mockGmailClient);
  });

  describe('getEmails', () => {
    const searchParams = {
      from: 'sender@example.com',
      subject: 'Test Subject',
      after: '2024-01-01',
    };

    it('should get emails with given criteria', async () => {
      // Setup
      (mockGmailClient.users.messages.list as jest.Mock).mockResolvedValue({ 
        data: mockGmailResponses.messageList 
      });
      (mockGmailClient.users.messages.get as jest.Mock).mockResolvedValue({ 
        data: mockGmailResponses.message 
      });

      // Execute
      const result = await gmailService.getEmails({
        email: testEmail,
        search: searchParams,
      });

      // Verify
      expect(result.emails.length).toBeGreaterThan(0);
      expect(result.emails[0]).toHaveProperty('id');
      expect(result.emails[0]).toHaveProperty('subject');
      expect(result.resultSummary.total).toBe(2);
    });

    it('should handle empty results', async () => {
      // Setup
      (mockGmailClient.users.messages.list as jest.Mock).mockResolvedValue({ data: {} });

      // Execute
      const result = await gmailService.getEmails({
        email: testEmail,
        search: searchParams,
      });

      // Verify
      expect(result.emails).toEqual([]);
      expect(result.resultSummary.total).toBe(0);
    });
  });

  describe('sendEmail', () => {
    const emailParams = {
      email: testEmail,
      to: ['recipient@example.com'],
      subject: 'Test Email',
      body: 'Hello, World!',
    };

    it('should send email successfully', async () => {
      // Setup
      const mockResponse = {
        data: {
          id: 'sent-msg-1',
          threadId: 'thread1',
          labelIds: ['SENT'],
        },
      };
      (mockGmailClient.users.messages.send as jest.Mock).mockResolvedValue(mockResponse);

      // Execute
      const result = await gmailService.sendEmail(emailParams);

      // Verify
      expect(result).toEqual({
        messageId: 'sent-msg-1',
        threadId: 'thread1',
        labelIds: ['SENT'],
      });
    });

    it('should handle send failure', async () => {
      // Setup
      (mockGmailClient.users.messages.send as jest.Mock).mockRejectedValue(
        new Error('Send failed')
      );

      // Execute & Verify
      await expect(gmailService.sendEmail(emailParams)).rejects.toThrow();
    });
  });

  describe('getWorkspaceGmailSettings', () => {
    it('should fetch Gmail settings', async () => {
      // Setup
      const mockProfile = {
        data: {
          emailAddress: testEmail,
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

      (mockGmailClient.users.getProfile as jest.Mock).mockResolvedValue(mockProfile);
      (mockGmailClient.users.settings.getAutoForwarding as jest.Mock).mockResolvedValue(mockSettings);
      (mockGmailClient.users.settings.getImap as jest.Mock).mockResolvedValue(mockSettings);
      (mockGmailClient.users.settings.getLanguage as jest.Mock).mockResolvedValue({ 
        data: { displayLanguage: 'en' } 
      });
      (mockGmailClient.users.settings.getPop as jest.Mock).mockResolvedValue(mockSettings);
      (mockGmailClient.users.settings.getVacation as jest.Mock).mockResolvedValue(mockSettings);

      // Execute
      const result = await gmailService.getWorkspaceGmailSettings({ email: testEmail });

      // Verify
      expect(result.profile.emailAddress).toBe(testEmail);
      expect(result.settings).toBeDefined();
    });

    it('should handle settings fetch failure', async () => {
      // Setup
      (mockGmailClient.users.getProfile as jest.Mock).mockRejectedValue(
        new Error('Fetch failed')
      );

      // Execute & Verify
      await expect(
        gmailService.getWorkspaceGmailSettings({ email: testEmail })
      ).rejects.toThrow();
    });
  });
});
