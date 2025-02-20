import { GmailService } from '../../../modules/gmail/service.js';
import { DraftResponse, GetDraftsResponse, SendEmailResponse } from '../../../modules/gmail/types.js';
import { mockAccountManager, mockGmailClient } from '../../../__helpers__/testSetup.js';

describe('GmailService', () => {
  let gmailService: GmailService;
  const testEmail = 'test@example.com';

  beforeEach(async () => {
    gmailService = new GmailService();
    await gmailService.init();
  });

  describe('getEmails', () => {
    const searchParams = {
      from: 'sender@example.com',
      subject: 'Test Subject',
      after: '2024-01-01',
    };

    it('should get emails with given criteria', async () => {
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
        expect(mockGmailClient.users.drafts.create).toHaveBeenCalledWith(expect.objectContaining({
          userId: 'me',
          requestBody: expect.any(Object)
        }));
      });

      it('should create a reply draft with proper headers', async () => {
        const replyParams = {
          ...draftParams,
          replyToMessageId: 'original-msg-1',
          threadId: 'thread-1',
          inReplyTo: 'original-msg-1',
          references: ['ref-1']
        };
        
        // Execute
        const result = (await gmailService.manageDraft({
          action: 'create',
          email: testEmail,
          data: replyParams
        })) as DraftResponse;

        // Verify
        expect(result.id).toBe('draft-2');
        expect(mockGmailClient.users.drafts.create).toHaveBeenCalledWith(expect.objectContaining({
          userId: 'me',
          requestBody: expect.objectContaining({
            message: expect.objectContaining({
              threadId: 'thread-1'
            })
          })
        }));
      });

      it('should handle draft creation failure', async () => {
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
        // Execute
        const result = (await gmailService.manageDraft({
          action: 'read',
          email: testEmail
        })) as GetDraftsResponse;

        // Verify
        expect(result.drafts.length).toBe(2);
        expect(result.nextPageToken).toBe('next-token');
        expect(result.resultSizeEstimate).toBe(2);
        expect(mockGmailClient.users.drafts.list).toHaveBeenCalledWith(expect.objectContaining({
          userId: 'me'
        }));
        expect(mockGmailClient.users.drafts.get).toHaveBeenCalledWith(expect.objectContaining({
          userId: 'me',
          id: expect.any(String)
        }));
      });

      it('should handle empty drafts list', async () => {
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
      // Execute
      const result = await gmailService.getWorkspaceGmailSettings({ email: testEmail });

      // Verify
      expect(result.profile.emailAddress).toBe(testEmail);
      expect(result.settings).toBeDefined();
    });

    it('should handle settings fetch failure', async () => {
      // Execute & Verify
      await expect(
        gmailService.getWorkspaceGmailSettings({ email: testEmail })
      ).rejects.toThrow();
    });
  });
});
