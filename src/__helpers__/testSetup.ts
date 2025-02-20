import { gmail_v1 } from 'googleapis';

// Basic mock token
const mockToken = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expiry_date: Date.now() + 3600000,
};

// Simple account manager mock
export const mockAccountManager = () => {
  const mockAuthClient = {
    setCredentials: jest.fn(),
  };

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    getAuthClient: jest.fn().mockResolvedValue(mockAuthClient),
    validateToken: jest.fn().mockResolvedValue({ valid: true, token: mockToken }),
    withTokenRenewal: jest.fn().mockImplementation((email, operation) => operation()),
  };
};

// Simple Gmail client mock
export const mockGmailClient = {
  users: {
    messages: {
      list: jest.fn().mockResolvedValue({ data: { messages: [] } }),
      get: jest.fn().mockResolvedValue({ data: {} }),
      send: jest.fn().mockResolvedValue({ data: { id: 'mock-message-id' } }),
    },
    drafts: {
      create: jest.fn().mockResolvedValue({ data: { id: 'mock-draft-id' } }),
      list: jest.fn().mockResolvedValue({ data: { drafts: [] } }),
      get: jest.fn().mockResolvedValue({ data: {} }),
      send: jest.fn().mockResolvedValue({ data: {} }),
    },
    getProfile: jest.fn().mockResolvedValue({ data: { emailAddress: 'test@example.com' } }),
    settings: {
      getAutoForwarding: jest.fn().mockResolvedValue({ data: {} }),
      getImap: jest.fn().mockResolvedValue({ data: {} }),
      getLanguage: jest.fn().mockResolvedValue({ data: {} }),
      getPop: jest.fn().mockResolvedValue({ data: {} }),
      getVacation: jest.fn().mockResolvedValue({ data: {} }),
    },
  },
});

// Initialize mocks before tests
beforeAll(() => {
  // Mock the account manager module
  jest.mock('../modules/accounts/index.js', () => ({
    initializeAccountModule: jest.fn().mockResolvedValue(mockAccountManager()),
    getAccountManager: jest.fn().mockReturnValue(mockAccountManager()),
  }));

  // Mock googleapis
  jest.mock('googleapis', () => ({
    google: {
      gmail: jest.fn().mockReturnValue(mockGmailClient),
    },
  }));
});

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
