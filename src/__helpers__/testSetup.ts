import { AccountManager } from '../modules/accounts/manager.js';
import { GoogleOAuthClient } from '../modules/accounts/oauth.js';
import { TokenManager } from '../modules/accounts/token.js';
import { mockTokens } from '../__fixtures__/accounts.js';
import { gmail_v1 } from 'googleapis';
import fs from 'fs/promises';

export const mockFileSystem = () => {
  jest.mock('fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(undefined),
  }));

  jest.mock('path', () => ({
    join: jest.fn((dir, file) => `${dir}/${file}`),
    resolve: jest.fn((...args) => args.join('/')),
    dirname: jest.fn(() => '/mock'),
  }));

  return {
    fs,
    setMockFileContent: (content: any) => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(content));
    },
  };
};

export const mockAccountManager = () => {
  const mockOAuthClient = {
    ensureInitialized: jest.fn().mockResolvedValue(undefined),
    getAuthClient: jest.fn().mockResolvedValue({}),
    generateAuthUrl: jest.fn().mockResolvedValue('https://mock-auth-url'),
    getTokenFromCode: jest.fn().mockResolvedValue(mockTokens.valid),
    refreshToken: jest.fn(),
  } as unknown as jest.Mocked<GoogleOAuthClient>;

  const mockTokenManager = {
    loadToken: jest.fn(),
    saveToken: jest.fn(),
    validateToken: jest.fn().mockResolvedValue({ valid: true, token: mockTokens.valid }),
    deleteToken: jest.fn(),
  } as unknown as jest.Mocked<TokenManager>;

  jest.mock('../modules/accounts/token.js', () => ({
    TokenManager: jest.fn().mockImplementation(() => mockTokenManager),
  }));

  jest.mock('../modules/accounts/oauth.js', () => ({
    GoogleOAuthClient: jest.fn().mockImplementation(() => mockOAuthClient),
  }));

  return {
    mockOAuthClient,
    mockTokenManager,
  };
};

export const mockGmailClient = () => {
  const mockClient = {
    users: {
      messages: {
        list: jest.fn(() => Promise.resolve({ data: {} })),
        get: jest.fn(() => Promise.resolve({ data: {} })),
        send: jest.fn(() => Promise.resolve({ data: {} })),
      },
      getProfile: jest.fn(() => Promise.resolve({ data: {} })),
      settings: {
        getAutoForwarding: jest.fn(() => Promise.resolve({ data: {} })),
        getImap: jest.fn(() => Promise.resolve({ data: {} })),
        getLanguage: jest.fn(() => Promise.resolve({ data: {} })),
        getPop: jest.fn(() => Promise.resolve({ data: {} })),
        getVacation: jest.fn(() => Promise.resolve({ data: {} })),
      },
    },
  } as unknown as jest.Mocked<gmail_v1.Gmail>;

  return mockClient;
};

export const setupTestEnvironment = () => {
  const fileSystem = mockFileSystem();
  const accountManager = mockAccountManager();
  const gmailClient = mockGmailClient();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ACCOUNTS_FILE = '/mock/accounts.json';
  });

  return {
    fileSystem,
    accountManager,
    gmailClient,
  };
};
