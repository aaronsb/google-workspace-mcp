import { gmail_v1 } from 'googleapis';
import type { AccountManager } from '../modules/accounts/manager.js' with { "resolution-mode": "import" };
import type { OAuth2Client } from 'google-auth-library' with { "resolution-mode": "import" };

// Basic mock token
const mockToken = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expiry_date: Date.now() + 3600000,
};

// Simple account manager mock
export const mockAccountManager = (): jest.Mocked<Partial<AccountManager>> => {
  const mockAuthClient: jest.Mocked<Partial<OAuth2Client>> = {
    setCredentials: jest.fn(),
  };

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    getAuthClient: jest.fn().mockResolvedValue(mockAuthClient),
    validateToken: jest.fn().mockResolvedValue({ valid: true, token: mockToken }),
    withTokenRenewal: jest.fn().mockImplementation((email, operation) => operation()),
  };
};

// Type for Gmail client that makes context optional but keeps users required
type MockGmailClient = Omit<gmail_v1.Gmail, 'context'> & { context?: gmail_v1.Gmail['context'] };

// Simple Gmail client mock with proper typing and success/failure cases
export const mockGmailClient: jest.Mocked<MockGmailClient> = {
  users: {
    messages: {
      list: jest.fn()
        .mockResolvedValueOnce({ // Success case with results
          data: {
            messages: [
              { id: 'msg-1', threadId: 'thread-1' },
              { id: 'msg-2', threadId: 'thread-1' }
            ],
            resultSizeEstimate: 2
          }
        })
        .mockResolvedValueOnce({ // Empty results case
          data: { 
            messages: [],
            resultSizeEstimate: 0
          }
        }),
      get: jest.fn().mockResolvedValue({
        data: {
          id: 'msg-1',
          threadId: 'thread-1',
          labelIds: ['INBOX'],
          snippet: 'Email preview...',
          payload: {
            headers: [
              { name: 'Subject', value: 'Test Subject' },
              { name: 'From', value: 'sender@example.com' },
              { name: 'To', value: 'recipient@example.com' },
              { name: 'Date', value: new Date().toISOString() }
            ],
            body: {
              data: Buffer.from('Email body content').toString('base64')
            }
          }
        }
      }),
      send: jest.fn()
        .mockResolvedValueOnce({ // Success case
          data: {
            id: 'sent-msg-1',
            threadId: 'thread-1',
            labelIds: ['SENT']
          }
        })
        .mockRejectedValueOnce(new Error('Send failed')), // Error case
    },
    drafts: {
      create: jest.fn()
        .mockResolvedValueOnce({ // Success case
          data: {
            id: 'draft-1',
            message: {
              id: 'msg-draft-1',
              threadId: 'thread-1',
              labelIds: ['DRAFT']
            },
            updated: new Date().toISOString()
          }
        })
        .mockResolvedValueOnce({ // Reply draft success case
          data: {
            id: 'draft-2',
            message: {
              id: 'msg-draft-2',
              threadId: 'thread-1',
              labelIds: ['DRAFT']
            },
            updated: new Date().toISOString()
          }
        })
        .mockRejectedValueOnce(new Error('Draft creation failed')), // Error case
      list: jest.fn()
        .mockResolvedValueOnce({ // Success case with drafts
          data: {
            drafts: [
              { id: 'draft-1' },
              { id: 'draft-2' }
            ],
            nextPageToken: 'next-token',
            resultSizeEstimate: 2
          }
        })
        .mockResolvedValueOnce({ // Empty drafts case
          data: {
            drafts: [],
            resultSizeEstimate: 0
          }
        }),
      get: jest.fn()
        .mockResolvedValue({ // Success case for draft details
          data: {
            id: 'draft-1',
            message: {
              id: 'msg-draft-1',
              threadId: 'thread-1',
              labelIds: ['DRAFT']
            }
          }
        }),
      send: jest.fn()
        .mockResolvedValueOnce({ // Success case
          data: {
            id: 'sent-msg-1',
            threadId: 'thread-1',
            labelIds: ['SENT']
          }
        })
        .mockRejectedValueOnce(new Error('Draft send failed')), // Error case
    },
    getProfile: jest.fn()
      .mockResolvedValueOnce({ // Success case
        data: {
          emailAddress: 'test@example.com',
          messagesTotal: 100,
          threadsTotal: 50,
          historyId: '12345'
        }
      })
      .mockRejectedValueOnce(new Error('Settings fetch failed')), // Error case
    settings: {
      getAutoForwarding: jest.fn().mockResolvedValue({
        data: {
          enabled: false,
          emailAddress: undefined
        }
      }),
      getImap: jest.fn().mockResolvedValue({
        data: {
          enabled: true,
          autoExpunge: true,
          expungeBehavior: 'archive'
        }
      }),
      getLanguage: jest.fn().mockResolvedValue({
        data: {
          displayLanguage: 'en'
        }
      }),
      getPop: jest.fn().mockResolvedValue({
        data: {
          enabled: false,
          accessWindow: 'disabled'
        }
      }),
      getVacation: jest.fn().mockResolvedValue({
        data: {
          enabled: false,
          startTime: undefined,
          endTime: undefined,
          responseSubject: '',
          message: ''
        }
      }),
    },
  } as any,
};

// Simple file system mock
export const mockFileSystem = () => {
  const fs = {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue(Buffer.from('test content')),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined),
    chmod: jest.fn().mockResolvedValue(undefined),
  };

  jest.mock('fs/promises', () => fs);

  return { fs };
};

// Mock the account manager module
jest.mock('../modules/accounts/index.js', () => ({
  initializeAccountModule: jest.fn().mockResolvedValue(mockAccountManager()),
  getAccountManager: jest.fn().mockReturnValue(mockAccountManager()),
}));

// Mock googleapis
jest.mock('googleapis', () => {
  const mockDrive = {
    files: {
      list: jest.fn(),
      create: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      export: jest.fn(),
    },
    permissions: {
      create: jest.fn(),
    },
  };

  return {
    google: {
      gmail: jest.fn().mockReturnValue(mockGmailClient),
      drive: jest.fn().mockReturnValue(mockDrive),
    },
  };
});

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
