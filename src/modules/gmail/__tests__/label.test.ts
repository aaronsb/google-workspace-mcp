import { GmailService } from '../services/base.js';
import { gmail_v1 } from 'googleapis';
import { Label } from '../types.js';
import { getAccountManager } from '../../../modules/accounts/index.js';
import { AccountManager } from '../../../modules/accounts/manager.js';
import logger from '../../../utils/logger.js';

jest.mock('../../../modules/accounts/index.js');
jest.mock('../../../modules/accounts/manager.js');
jest.mock('../../../utils/logger.js', () => ({
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Gmail Label Service', () => {
  let gmailService: GmailService;
  let mockGmailClient: any;
  let mockAccountManager: jest.Mocked<AccountManager>;
  const testEmail = 'test@example.com';

  beforeEach(() => {
    mockGmailClient = {
      users: {
        labels: {
          list: jest.fn(),
          create: jest.fn(),
          patch: jest.fn(),
          delete: jest.fn()
        },
        messages: {
          modify: jest.fn()
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
    
    // Initialize label service with mock client
    (gmailService as any).labelService.updateClient(mockGmailClient);
  });

  describe('getLabels', () => {
    it('should fetch all labels', async () => {
      // Simple mock response
      const mockResponse = {
        data: {
          labels: [
            {
              id: 'label1',
              name: 'Test Label',
              type: 'user',
              messageListVisibility: 'show',
              labelListVisibility: 'labelShow'
            }
          ]
        }
      };

      // Set up mock
      (mockGmailClient.users.labels.list as jest.Mock).mockResolvedValue(mockResponse);

      const result = await gmailService.getLabels({ email: testEmail });

      // Simple assertions
      expect(result.labels).toHaveLength(1);
      expect(result.labels[0].id).toBe('label1');
      expect(result.labels[0].name).toBe('Test Label');
      expect(mockGmailClient.users.labels.list).toHaveBeenCalledWith({
        userId: testEmail
      });
    });

    it('should handle empty labels response', async () => {
      // Simple mock for empty response
      (mockGmailClient.users.labels.list as jest.Mock).mockResolvedValue({
        data: { labels: [] }
      });

      const result = await gmailService.getLabels({ email: testEmail });
      expect(result.labels).toHaveLength(0);
    });

    it('should handle errors when fetching labels', async () => {
      // Simple error mock
      (mockGmailClient.users.labels.list as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.getLabels({ email: testEmail }))
        .rejects
        .toThrow('Failed to fetch labels');
    });
  });

  describe('createLabel', () => {
    it('should create a new label', async () => {
      // Simple mock response
      const mockResponse = {
        data: {
          id: 'label1',
          name: 'Test Label',
          type: 'user',
          messageListVisibility: 'show',
          labelListVisibility: 'labelShow'
        }
      };

      // Set up mock
      (mockGmailClient.users.labels.create as jest.Mock).mockResolvedValue(mockResponse);

      // Simple test input
      const input = {
        email: testEmail,
        name: 'Test Label'
      };

      const result = await gmailService.createLabel(input);

      // Simple assertions
      expect(result.id).toBe('label1');
      expect(result.name).toBe('Test Label');
      expect(mockGmailClient.users.labels.create).toHaveBeenCalledWith({
        userId: testEmail,
        requestBody: expect.objectContaining({
          name: 'Test Label'
        })
      });
    });

    it('should handle errors when creating a label', async () => {
      // Simple error mock
      (mockGmailClient.users.labels.create as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.createLabel({
        email: testEmail,
        name: 'Test Label'
      })).rejects.toThrow('Failed to create label');
    });
  });

  describe('updateLabel', () => {
    it('should update an existing label', async () => {
      // Simple mock response
      const mockResponse = {
        data: {
          id: 'label1',
          name: 'Updated Label',
          type: 'user',
          messageListVisibility: 'show',
          labelListVisibility: 'labelShow'
        }
      };

      // Set up mock
      (mockGmailClient.users.labels.patch as jest.Mock).mockResolvedValue(mockResponse);

      // Simple test input
      const input = {
        email: testEmail,
        labelId: 'label1',
        name: 'Updated Label'
      };

      const result = await gmailService.updateLabel(input);

      // Simple assertions
      expect(result.id).toBe('label1');
      expect(result.name).toBe('Updated Label');
      expect(mockGmailClient.users.labels.patch).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'label1',
        requestBody: expect.objectContaining({
          name: 'Updated Label'
        })
      });
    });

    it('should handle errors when updating a label', async () => {
      // Simple error mock
      (mockGmailClient.users.labels.patch as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.updateLabel({
        email: testEmail,
        labelId: 'label1',
        name: 'Updated Label'
      })).rejects.toThrow('Failed to update label');
    });
  });

  describe('deleteLabel', () => {
    it('should delete a label', async () => {
      // Simple mock response
      (mockGmailClient.users.labels.delete as jest.Mock).mockResolvedValue({});

      // Simple test input
      const input = {
        email: testEmail,
        labelId: 'label1'
      };

      // Execute and verify
      await gmailService.deleteLabel(input);

      // Simple assertions
      expect(mockGmailClient.users.labels.delete).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'label1'
      });
    });

    it('should handle errors when deleting a label', async () => {
      // Simple error mock
      (mockGmailClient.users.labels.delete as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.deleteLabel({
        email: testEmail,
        labelId: 'label1'
      })).rejects.toThrow('Failed to delete label');
    });
  });

  describe('modifyMessageLabels', () => {
    it('should modify message labels', async () => {
      // Simple mock response
      (mockGmailClient.users.messages.modify as jest.Mock).mockResolvedValue({});

      // Simple test input
      const input = {
        email: testEmail,
        messageId: 'msg1',
        addLabelIds: ['label1'],
        removeLabelIds: ['label2']
      };

      // Execute and verify
      await gmailService.modifyMessageLabels(input);

      // Simple assertions
      expect(mockGmailClient.users.messages.modify).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'msg1',
        requestBody: {
          addLabelIds: ['label1'],
          removeLabelIds: ['label2']
        }
      });
    });

    it('should handle errors when modifying message labels', async () => {
      // Simple error mock
      (mockGmailClient.users.messages.modify as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.modifyMessageLabels({
        email: testEmail,
        messageId: 'msg1',
        addLabelIds: ['label1'],
        removeLabelIds: ['label2']
      })).rejects.toThrow('Failed to modify message labels');
    });
  });
});
