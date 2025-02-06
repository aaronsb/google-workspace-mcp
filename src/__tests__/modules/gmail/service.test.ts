import { GmailService } from '../../../modules/gmail/service.js';
import { mockGmailResponses } from '../../../__fixtures__/accounts.js';
import { setupTestEnvironment } from '../../../__helpers__/testSetup.js';
import { getAccountManager } from '../../../modules/accounts/index.js';
import { SearchService } from '../../../modules/gmail/services/search.js';
import { EmailService } from '../../../modules/gmail/services/email.js';
import { DraftService } from '../../../modules/gmail/services/draft.js';
import { SettingsService } from '../../../modules/gmail/services/settings.js';

jest.mock('../../../modules/accounts/index.js');

describe('GmailService', () => {
  const { accountManager: mocks, gmailClient: mockGmailClient } = setupTestEnvironment();
  let gmailService: GmailService;
  const testEmail = 'test@example.com';

  beforeEach(() => {
    // Simple mock for account manager
    (getAccountManager as jest.Mock).mockReturnValue({
      getAuthClient: jest.fn().mockResolvedValue({})
    });
    
    gmailService = new GmailService();
    
    // Create a minimal mock OAuth client
    const mockOAuth2Client = {
      setCredentials: jest.fn(),
      getAccessToken: jest.fn(),
      refreshAccessToken: jest.fn()
    } as any;

    // Mock internal services directly
    (gmailService as any).gmailClient = mockGmailClient;
    (gmailService as any).oauth2Client = mockOAuth2Client;
    (gmailService as any).searchService = new SearchService();
    (gmailService as any).emailService = new EmailService(mockGmailClient, mockOAuth2Client, (gmailService as any).searchService);
    (gmailService as any).draftService = new DraftService(mockGmailClient, mockOAuth2Client, (gmailService as any).emailService);
    (gmailService as any).settingsService = new SettingsService(mockGmailClient, mockOAuth2Client);
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
