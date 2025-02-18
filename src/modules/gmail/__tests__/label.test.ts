import { GmailService } from '../services/base.js';
import { gmail_v1 } from 'googleapis';
import { Label } from '../types.js';

jest.mock('googleapis');

describe('Gmail Label Service', () => {
  let gmailService: GmailService;
  let mockLabels: gmail_v1.Schema$Label[];
  const testEmail = 'test@example.com';

  beforeEach(() => {
    gmailService = new GmailService();
    mockLabels = [
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
  });

  describe('getLabels', () => {
    it('should fetch all labels', async () => {
      const mockResponse = {
        data: {
          labels: mockLabels
        }
      };

      const mockGmail = {
        users: {
          labels: {
            list: jest.fn().mockResolvedValue(mockResponse)
          }
        }
      };

      (gmailService as any).getAuthenticatedClient = jest.fn().mockResolvedValue(mockGmail);

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
      const newLabel = mockLabels[0];
      const mockResponse = {
        data: newLabel
      };

      const mockGmail = {
        users: {
          labels: {
            create: jest.fn().mockResolvedValue(mockResponse)
          }
        }
      };

      (gmailService as any).getAuthenticatedClient = jest.fn().mockResolvedValue(mockGmail);

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
        ...mockLabels[0],
        name: 'Very Important'
      };
      const mockResponse = {
        data: updatedLabel
      };

      const mockGmail = {
        users: {
          labels: {
            patch: jest.fn().mockResolvedValue(mockResponse)
          }
        }
      };

      (gmailService as any).getAuthenticatedClient = jest.fn().mockResolvedValue(mockGmail);

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
      const mockGmail = {
        users: {
          labels: {
            delete: jest.fn().mockResolvedValue({})
          }
        }
      };

      (gmailService as any).getAuthenticatedClient = jest.fn().mockResolvedValue(mockGmail);

      await expect(gmailService.deleteLabel({
        email: testEmail,
        labelId: 'label1'
      })).resolves.not.toThrow();

      expect(mockGmail.users.labels.delete).toHaveBeenCalledWith({
        userId: testEmail,
        id: 'label1'
      });
    });
  });

  describe('modifyMessageLabels', () => {
    it('should modify message labels', async () => {
      const mockGmail = {
        users: {
          messages: {
            modify: jest.fn().mockResolvedValue({})
          }
        }
      };

      (gmailService as any).getAuthenticatedClient = jest.fn().mockResolvedValue(mockGmail);

      await expect(gmailService.modifyMessageLabels({
        email: testEmail,
        messageId: 'msg1',
        addLabelIds: ['label1'],
        removeLabelIds: ['label2']
      })).resolves.not.toThrow();

      expect(mockGmail.users.messages.modify).toHaveBeenCalledWith({
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
      const mockGmail = {
        users: {
          labels: {
            list: jest.fn().mockRejectedValue(new Error('API Error'))
          }
        }
      };

      (gmailService as any).getAuthenticatedClient = jest.fn().mockResolvedValue(mockGmail);

      await expect(gmailService.getLabels({ email: testEmail }))
        .rejects
        .toThrow('Failed to fetch labels');
    });
  });
});
