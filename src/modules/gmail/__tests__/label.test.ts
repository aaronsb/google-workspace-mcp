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
      const mockLabels = [
        {
          id: 'label1',
          name: 'Important',
          type: 'user',
          messageListVisibility: 'show',
          labelListVisibility: 'labelShow',
          color: {
            textColor: '#ffffff',
            backgroundColor: '#000000'
          }
        },
        {
          id: 'label2',
          name: 'Work',
          type: 'user',
          messageListVisibility: 'show',
          labelListVisibility: 'labelShow'
        }
      ];

      (mockGmailClient.users.labels.list as jest.Mock).mockResolvedValue({
        data: { labels: mockLabels }
      });

      const result = await gmailService.getLabels({ email: testEmail });

      expect(result.labels).toHaveLength(2);
      expect(result.labels[0].id).toBe('label1');
      expect(result.labels[0].name).toBe('Important');
      expect(result.labels[0].color).toBeDefined();
      expect(result.labels[1].id).toBe('label2');
      expect(result.labels[1].color).toBeUndefined();
    });
  });

  describe('createLabel', () => {
    it('should create a new label', async () => {
      const newLabel = {
        id: 'label1',
        name: 'Important',
        type: 'user',
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
        color: {
          textColor: '#ffffff',
          backgroundColor: '#000000'
        }
      };

      (mockGmailClient.users.labels.create as jest.Mock).mockResolvedValue({
        data: newLabel
      });

      const result = await gmailService.createLabel({
        email: testEmail,
        name: 'Important',
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
        color: {
          textColor: '#ffffff',
          backgroundColor: '#000000'
        }
      });

      expect(result.name).toBe('Important');
      expect(result.color).toBeDefined();
      expect(result.color?.textColor).toBe('#ffffff');
    });
  });

  describe('updateLabel', () => {
    it('should update an existing label', async () => {
      const updatedLabel = {
        id: 'label1',
        name: 'Very Important',
        type: 'user',
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
        color: {
          textColor: '#ffffff',
          backgroundColor: '#000000'
        }
      };

      (mockGmailClient.users.labels.patch as jest.Mock).mockResolvedValue({
        data: updatedLabel
      });

      const result = await gmailService.updateLabel({
        email: testEmail,
        labelId: 'label1',
        name: 'Very Important'
      });

      expect(result.name).toBe('Very Important');
      expect(result.id).toBe('label1');
    });
  });

  describe('deleteLabel', () => {
    it('should delete a label', async () => {
      (mockGmailClient.users.labels.delete as jest.Mock).mockResolvedValue({});

      await expect(gmailService.deleteLabel({
        email: testEmail,
        labelId: 'label1'
      })).resolves.not.toThrow();

      expect(mockGmailClient.users.labels.delete).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'label1'
      });
    });
  });

  describe('modifyMessageLabels', () => {
    it('should modify message labels', async () => {
      (mockGmailClient.users.messages.modify as jest.Mock).mockResolvedValue({});

      await expect(gmailService.modifyMessageLabels({
        email: testEmail,
        messageId: 'msg1',
        addLabelIds: ['label1'],
        removeLabelIds: ['label2']
      })).resolves.not.toThrow();

      expect(mockGmailClient.users.messages.modify).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'msg1',
        requestBody: {
          addLabelIds: ['label1'],
          removeLabelIds: ['label2']
        }
      });
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      (mockGmailClient.users.labels.list as jest.Mock).mockRejectedValue(
        new Error('API Error')
      );

      await expect(gmailService.getLabels({ email: testEmail }))
        .rejects
        .toThrow('Failed to fetch labels');
    });
  });
});
