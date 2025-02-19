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
  let mockClient: any;
  const testEmail = 'test@example.com';

  beforeAll(() => {
    // Mock getAccountManager at module level
    (getAccountManager as jest.Mock).mockReturnValue({
      validateToken: jest.fn().mockResolvedValue({ valid: true, token: {} }),
      getAuthClient: jest.fn().mockResolvedValue({})
    });
  });

  beforeEach(async () => {
    
    // Create a fresh instance for each test
    gmailService = new GmailService();

    // Create mock client
    mockClient = {
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

    // Mock the Gmail client methods at service level
    (gmailService as any).getGmailClient = jest.fn().mockResolvedValue(mockClient);

    // Initialize the service and update label service client
    await gmailService.init();
    (gmailService as any).labelService.updateClient(mockClient);
  });

  describe('manageLabel - read', () => {
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
      (mockClient.users.labels.list as jest.Mock).mockResolvedValue(mockResponse);

      const result = await gmailService.manageLabel({
        action: 'read',
        email: testEmail
      });

      // Simple assertions
      expect((result as any).labels).toHaveLength(1);
      expect((result as any).labels[0].id).toBe('label1');
      expect((result as any).labels[0].name).toBe('Test Label');
      expect(mockClient.users.labels.list).toHaveBeenCalledWith({
        userId: testEmail
      });
    });

    it('should handle empty labels response', async () => {
      // Simple mock for empty response
      (mockClient.users.labels.list as jest.Mock).mockResolvedValue({
        data: { labels: [] }
      });

      const result = await gmailService.manageLabel({
        action: 'read',
        email: testEmail
      });
      expect((result as any).labels).toHaveLength(0);
    });

    it('should handle errors when fetching labels', async () => {
      // Simple error mock
      (mockClient.users.labels.list as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.manageLabel({
        action: 'read',
        email: testEmail
      }))
        .rejects
        .toThrow('Failed to fetch labels');
    });
  });

  describe('manageLabel - create', () => {
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
      (mockClient.users.labels.create as jest.Mock).mockResolvedValue(mockResponse);

      const result = await gmailService.manageLabel({
        action: 'create',
        email: testEmail,
        data: {
          name: 'Test Label'
        }
      });

      // Simple assertions
      expect((result as Label).id).toBe('label1');
      expect((result as Label).name).toBe('Test Label');
      expect(mockClient.users.labels.create).toHaveBeenCalledWith({
        userId: testEmail,
        requestBody: expect.objectContaining({
          name: 'Test Label'
        })
      });
    });

    it('should handle errors when creating a label', async () => {
      // Simple error mock
      (mockClient.users.labels.create as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.manageLabel({
        action: 'create',
        email: testEmail,
        data: {
          name: 'Test Label'
        }
      })).rejects.toThrow('Failed to create label');
    });
  });

  describe('manageLabel - update', () => {
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
      (mockClient.users.labels.patch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await gmailService.manageLabel({
        action: 'update',
        email: testEmail,
        labelId: 'label1',
        data: {
          name: 'Updated Label'
        }
      });

      // Simple assertions
      expect((result as Label).id).toBe('label1');
      expect((result as Label).name).toBe('Updated Label');
      expect(mockClient.users.labels.patch).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'label1',
        requestBody: expect.objectContaining({
          name: 'Updated Label'
        })
      });
    });

    it('should handle errors when updating a label', async () => {
      // Simple error mock
      (mockClient.users.labels.patch as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.manageLabel({
        action: 'update',
        email: testEmail,
        labelId: 'label1',
        data: {
          name: 'Updated Label'
        }
      })).rejects.toThrow('Failed to update label');
    });
  });

  describe('manageLabel - delete', () => {
    it('should delete a label', async () => {
      // Simple mock response
      (mockClient.users.labels.delete as jest.Mock).mockResolvedValue({});

      // Execute and verify
      await gmailService.manageLabel({
        action: 'delete',
        email: testEmail,
        labelId: 'label1'
      });

      // Simple assertions
      expect(mockClient.users.labels.delete).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'label1'
      });
    });

    it('should handle errors when deleting a label', async () => {
      // Simple error mock
      (mockClient.users.labels.delete as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.manageLabel({
        action: 'delete',
        email: testEmail,
        labelId: 'label1'
      })).rejects.toThrow('Failed to delete label');
    });
  });

  describe('manageLabelAssignment', () => {
    it('should add labels to a message', async () => {
      // Simple mock response
      (mockClient.users.messages.modify as jest.Mock).mockResolvedValue({});

      // Execute and verify
      await gmailService.manageLabelAssignment({
        action: 'add',
        email: testEmail,
        messageId: 'msg1',
        labelIds: ['label1']
      });

      // Simple assertions
      expect(mockClient.users.messages.modify).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'msg1',
        requestBody: {
          addLabelIds: ['label1'],
          removeLabelIds: []
        }
      });
    });

    it('should remove labels from a message', async () => {
      // Simple mock response
      (mockClient.users.messages.modify as jest.Mock).mockResolvedValue({});

      // Execute and verify
      await gmailService.manageLabelAssignment({
        action: 'remove',
        email: testEmail,
        messageId: 'msg1',
        labelIds: ['label2']
      });

      // Simple assertions
      expect(mockClient.users.messages.modify).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'msg1',
        requestBody: {
          addLabelIds: [],
          removeLabelIds: ['label2']
        }
      });
    });

    it('should handle errors when modifying message labels', async () => {
      // Simple error mock
      (mockClient.users.messages.modify as jest.Mock).mockRejectedValue(new Error('API Error'));

      await expect(gmailService.manageLabelAssignment({
        action: 'add',
        email: testEmail,
        messageId: 'msg1',
        labelIds: ['label1']
      })).rejects.toThrow('Failed to modify message labels');
    });
  });
});
