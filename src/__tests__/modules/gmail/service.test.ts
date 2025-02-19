import { GmailService } from '../../../modules/gmail/service.js';
import { mockGmailResponses } from '../../../__fixtures__/accounts.js';
import { getAccountManager } from '../../../modules/accounts/index.js';
import { AccountManager } from '../../../modules/accounts/manager.js';
import { DraftResponse, GetDraftsResponse, SendEmailResponse } from '../../../modules/gmail/types.js';

jest.mock('../../../modules/accounts/index.js');
jest.mock('../../../modules/accounts/manager.js');

describe('GmailService', () => {
  let gmailService: GmailService;
  let mockGmailClient: any;
  let mockAccountManager: jest.Mocked<AccountManager>;
  const testEmail = 'test@example.com';

  beforeEach(() => {
    mockGmailClient = {
      users: {
        messages: {
          list: jest.fn(),
          get: jest.fn(),
          send: jest.fn()
        },
        drafts: {
          create: jest.fn(),
          list: jest.fn(),
          get: jest.fn(),
          send: jest.fn()
        },
        getProfile: jest.fn(),
        settings: {
          getAutoForwarding: jest.fn(),
          getImap: jest.fn(),
          getLanguage: jest.fn(),
          getPop: jest.fn(),
          getVacation: jest.fn()
        }
      }
    };

    mockAccountManager = {
      validateToken: jest.fn().mockResolvedValue({ valid: true, token: {} }),
      getAuthClient: jest.fn().mockResolvedValue({})
    } as unknown as jest.Mocked<AccountManager>;

    (getAccountManager as jest.Mock).mockReturnValue(mockAccountManager);

    gmailService = new GmailService();
    (gmailService as any).getGmailClient = jest.fn().mockResolvedValue(mockGmailClient);
    
    // Initialize internal services with mock client
    (gmailService as any).emailService.updateClient(mockGmailClient);
    (gmailService as any).draftService.updateClient(mockGmailClient);
    (gmailService as any).settingsService.updateClient(mockGmailClient);
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

  describe('manageDraft', () => {
    const draftParams = {
      email: testEmail,
      to: ['recipient@example.com'],
      subject: 'Test Draft',
      body: 'Draft content',
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com']
    };

    describe('create action', () => {
      it('should create a new draft successfully', async () => {
        // Setup
        const mockDraftResponse = {
          data: {
            id: 'draft-1',
            message: { id: 'msg-1' }
          }
        };
        (mockGmailClient.users.drafts.create as jest.Mock).mockResolvedValue(mockDraftResponse);
        (mockGmailClient.users.messages.get as jest.Mock).mockResolvedValue({ 
          data: mockGmailResponses.message 
        });

        // Execute
        const result = (await gmailService.manageDraft({
          action: 'create',
          email: testEmail,
          data: draftParams
        })) as DraftResponse;

        // Verify
        expect(result.id).toBe('draft-1');
        expect(result.message).toBeDefined();
        expect(result.updated).toBeDefined();
        expect(mockGmailClient.users.drafts.create).toHaveBeenCalled();
      });

      it('should create a reply draft with proper headers', async () => {
        // Setup
        const replyParams = {
          ...draftParams,
          replyToMessageId: 'original-msg-1',
          threadId: 'thread-1',
          inReplyTo: 'original-msg-1',
          references: ['ref-1']
        };
        
        const mockDraftResponse = {
          data: {
            id: 'draft-2',
            message: { id: 'msg-2' }
          }
        };
        (mockGmailClient.users.drafts.create as jest.Mock).mockResolvedValue(mockDraftResponse);
        (mockGmailClient.users.messages.get as jest.Mock).mockResolvedValue({ 
          data: {
            ...mockGmailResponses.message,
            threadId: 'thread-1',
            headers: { References: 'ref-1' }
          }
        });

        // Execute
        const result = (await gmailService.manageDraft({
          action: 'create',
          email: testEmail,
          data: replyParams
        })) as DraftResponse;

        // Verify
        expect(result.id).toBe('draft-2');
        expect(mockGmailClient.users.drafts.create).toHaveBeenCalledWith(
          expect.objectContaining({
            requestBody: expect.objectContaining({
              message: expect.objectContaining({
                threadId: 'thread-1'
              })
            })
          })
        );
      });

      it('should handle draft creation failure', async () => {
        // Setup
        (mockGmailClient.users.drafts.create as jest.Mock).mockRejectedValue(
          new Error('Draft creation failed')
        );

        // Execute & Verify
        await expect(gmailService.manageDraft({
          action: 'create',
          email: testEmail,
          data: draftParams
        })).rejects.toThrow();
      });
    });

    describe('list action', () => {
      it('should list drafts successfully', async () => {
        // Setup
        const mockDraftsList = {
          data: {
            drafts: [
              { id: 'draft-1', message: { id: 'msg-1' } },
              { id: 'draft-2', message: { id: 'msg-2' } }
            ],
            nextPageToken: 'next-token',
            resultSizeEstimate: 2
          }
        };
        const mockDraftGet = {
          data: {
            id: 'draft-1',
            message: { 
              id: 'msg-1',
              internalDate: '1643673600000'
            }
          }
        };

        (mockGmailClient.users.drafts.list as jest.Mock).mockResolvedValue(mockDraftsList);
        (mockGmailClient.users.drafts.get as jest.Mock).mockResolvedValue(mockDraftGet);
        (mockGmailClient.users.messages.get as jest.Mock).mockResolvedValue({ 
          data: mockGmailResponses.message 
        });

        // Execute
        const result = (await gmailService.manageDraft({
          action: 'read',
          email: testEmail
        })) as GetDraftsResponse;

        // Verify
        expect(result.drafts.length).toBe(2);
        expect(result.nextPageToken).toBe('next-token');
        expect(result.resultSizeEstimate).toBe(2);
        expect(mockGmailClient.users.drafts.list).toHaveBeenCalled();
        expect(mockGmailClient.users.drafts.get).toHaveBeenCalled();
      });

      it('should handle empty drafts list', async () => {
        // Setup
        (mockGmailClient.users.drafts.list as jest.Mock).mockResolvedValue({ 
          data: {} 
        });

        // Execute
        const result = (await gmailService.manageDraft({
          action: 'read',
          email: testEmail
        })) as GetDraftsResponse;

        // Verify
        expect(result.drafts).toEqual([]);
        expect(result.resultSizeEstimate).toBe(0);
      });

      it('should handle drafts fetch failure', async () => {
        // Setup
        (mockGmailClient.users.drafts.list as jest.Mock).mockRejectedValue(
          new Error('Drafts fetch failed')
        );

        // Execute & Verify
        await expect(gmailService.manageDraft({
          action: 'read',
          email: testEmail
        })).rejects.toThrow();
      });
    });

    describe('send action', () => {
      const sendDraftParams = {
        draftId: 'draft-1'
      };

      it('should send draft successfully', async () => {
        // Setup
        const mockResponse = {
          data: {
            id: 'sent-msg-1',
            threadId: 'thread-1',
            labelIds: ['SENT']
          }
        };
        (mockGmailClient.users.drafts.send as jest.Mock).mockResolvedValue(mockResponse);

        // Execute
        const result = (await gmailService.manageDraft({
          action: 'send',
          email: testEmail,
          draftId: sendDraftParams.draftId
        })) as SendEmailResponse;

        // Verify
        expect(result.messageId).toBe('sent-msg-1');
        expect(result.threadId).toBe('thread-1');
        expect(result.labelIds).toEqual(['SENT']);
        expect(mockGmailClient.users.drafts.send).toHaveBeenCalledWith({
          userId: 'me',
          requestBody: { id: 'draft-1' }
        });
      });

      it('should handle send draft failure', async () => {
        // Setup
        (mockGmailClient.users.drafts.send as jest.Mock).mockRejectedValue(
          new Error('Draft send failed')
        );

        // Execute & Verify
        await expect(gmailService.manageDraft({
          action: 'send',
          email: testEmail,
          draftId: sendDraftParams.draftId
        })).rejects.toThrow();
      });
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
