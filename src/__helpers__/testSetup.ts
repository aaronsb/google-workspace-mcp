import { gmail_v1 } from 'googleapis';
import type { AccountManager } from '../modules/accounts/manager.js' with { "resolution-mode": "import" };
import type { GoogleOAuthClient } from '../modules/accounts/oauth.js' with { "resolution-mode": "import" };
import type { TokenManager } from '../modules/accounts/token.js' with { "resolution-mode": "import" };

let AccountManagerClass: typeof AccountManager;
let GoogleOAuthClientClass: typeof GoogleOAuthClient;
let TokenManagerClass: typeof TokenManager;
let mockTokens: any;

// Initialize the dynamic imports
const initializeModules = async () => {
  const manager = await import('../modules/accounts/manager.js');
  const oauth = await import('../modules/accounts/oauth.js');
  const token = await import('../modules/accounts/token.js');
  const accounts = await import('../__fixtures__/accounts.js');

  AccountManagerClass = manager.AccountManager;
  GoogleOAuthClientClass = oauth.GoogleOAuthClient;
  TokenManagerClass = token.TokenManager;
  mockTokens = accounts.mockTokens;
};

// Run initialization before tests
beforeAll(async () => {
  await initializeModules();
});

export const mockFileSystem = () => {
  const mockFs = {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined), // Add access check
    chmod: jest.fn().mockResolvedValue(undefined), // Add chmod for permissions
  };

  jest.mock('fs/promises', () => mockFs);

  jest.mock('path', () => ({
    join: jest.fn((dir, file) => `${dir}/${file}`),
    resolve: jest.fn((...args) => args.join('/')),
    dirname: jest.fn(() => '/app/config'),  // Update to container path
  }));

  // Default empty response
  mockFs.readFile.mockResolvedValue('{"accounts":[]}');

  // Mock directory access check
  mockFs.access.mockImplementation((path) => {
    if (path === '/app/config') {
      return Promise.resolve();
    }
    const error = new Error('Directory not accessible');
    (error as any).code = 'ENOENT';
    return Promise.reject(error);
  });

  return {
    fs: mockFs,
    setMockFileContent: (content: any) => {
      if (typeof content === 'string') {
        mockFs.readFile.mockImplementation((path: string) => {
          console.log('Reading file (string):', path);
          return Promise.resolve(content);
        });
      } else if (content === null || content === undefined) {
        mockFs.readFile.mockImplementation((path: string) => {
          console.log('Reading file (null/undefined):', path);
          return Promise.resolve('{"accounts":[]}');
        });
      } else {
        mockFs.readFile.mockImplementation((path: string) => {
          if (path.includes('gauth.json')) {
            return Promise.resolve(JSON.stringify({
              client_id: 'mock-client-id',
              client_secret: 'mock-client-secret',
              redirect_uri: 'http://localhost:3000/oauth2callback'
            }));
          }
          // Use JSON.stringify with proper spacing for readability in logs
          const mockData = JSON.stringify(content, null, 2);
          console.log('Mock data for', path, ':', mockData);
          return Promise.resolve(mockData);
        });
      }
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
  } as unknown as jest.Mocked<typeof GoogleOAuthClient>;

  const mockTokenManager = {
    loadToken: jest.fn(),
    saveToken: jest.fn(),
    validateToken: jest.fn().mockResolvedValue({ valid: true, token: mockTokens.valid }),
    deleteToken: jest.fn(),
  } as unknown as jest.Mocked<typeof TokenManager>;

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
      drafts: {
        create: jest.fn(() => Promise.resolve({ data: {} })),
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
    process.env.ACCOUNTS_FILE = '/app/config/accounts.json';
    process.env.AUTH_CONFIG_FILE = '/app/config/gauth.json';
    process.env.CREDENTIALS_DIR = '/app/config/credentials';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  return {
    fileSystem,
    accountManager,
    gmailClient,
  };
};
