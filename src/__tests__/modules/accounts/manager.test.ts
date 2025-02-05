import { AccountManager } from '../../../modules/accounts/manager.js';
import { Account, AccountsConfig } from '../../../modules/accounts/types.js';
import { GoogleOAuthClient } from '../../../modules/accounts/oauth.js';
import { TokenManager } from '../../../modules/accounts/token.js';
import fs from 'fs/promises';
import path from 'path';

jest.mock('path', () => ({
  join: jest.fn((dir, file) => `${dir}/${file}`),
  resolve: jest.fn((...args) => args.join('/')),
  dirname: jest.fn((p) => '/mock'),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../modules/accounts/token.js');
jest.mock('../../../modules/accounts/oauth.js');

describe('AccountManager', () => {
  let accountManager: AccountManager;
  let mockOAuthClient: jest.Mocked<GoogleOAuthClient>;
  let mockTokenManager: jest.Mocked<TokenManager>;

  const mockAccounts: AccountsConfig = {
    accounts: [
      {
        email: 'test@example.com',
        category: 'work',
        description: 'Test Work Account',
      },
      {
        email: 'test2@example.com',
        category: 'personal',
        description: 'Test Personal Account',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ACCOUNTS_FILE = '/mock/accounts.json';

    // Reset fs mocks
    jest.clearAllMocks();

    mockOAuthClient = {
      ensureInitialized: jest.fn().mockResolvedValue(undefined),
      getAuthClient: jest.fn().mockResolvedValue({}),
      generateAuthUrl: jest.fn().mockResolvedValue('https://mock-auth-url'),
      getTokenFromCode: jest.fn().mockResolvedValue({}),
      refreshToken: jest.fn(),
    } as unknown as jest.Mocked<GoogleOAuthClient>;

    mockTokenManager = {
      loadToken: jest.fn(),
      saveToken: jest.fn(),
      validateToken: jest.fn(),
      deleteToken: jest.fn(),
    } as unknown as jest.Mocked<TokenManager>;

    (TokenManager as jest.Mock).mockImplementation(() => mockTokenManager);
    (GoogleOAuthClient as jest.Mock).mockImplementation(() => mockOAuthClient);

    accountManager = new AccountManager();
  });

  describe('loadAccounts', () => {
    it('should load and parse accounts file', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockAccounts));

      await accountManager.loadAccounts();
      const accounts = await accountManager.listAccounts();
      
      // Mock token validation for listAccounts
      mockTokenManager.validateToken.mockResolvedValue({ valid: true });
      
      expect(accounts).toHaveLength(mockAccounts.accounts.length);
      expect(accounts[0].email).toBe(mockAccounts.accounts[0].email);
      expect(accounts[1].email).toBe(mockAccounts.accounts[1].email);
      expect(fs.readFile).toHaveBeenCalledWith('/mock/accounts.json', 'utf-8');
    });

    it('should create empty accounts file if it does not exist', async () => {
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      (fs.readFile as jest.Mock).mockRejectedValueOnce(error);
      
      // Mock the write of empty accounts file
      (fs.writeFile as jest.Mock).mockResolvedValueOnce(undefined);
      // Mock subsequent read of empty accounts
      (fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify({ accounts: [] }));

      await accountManager.loadAccounts();
      const accounts = await accountManager.listAccounts();
      
      expect(accounts).toEqual([]);
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/mock/accounts.json',
        JSON.stringify({ accounts: [] })
      );
    });
  });

  describe('validateAccount', () => {
    const mockEmail = 'test@example.com';
    const mockCategory = 'work';
    const mockDescription = 'Test Work Account';

    beforeEach(async () => {
      // Initialize accounts map before each test
      await accountManager.loadAccounts();
    });

    it('should validate existing account with valid token', async () => {
      const mockTokenStatus = {
        valid: true,
        token: { access_token: 'valid-token' },
      };

      // Setup account data
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockAccounts));
      await accountManager.loadAccounts();

      mockTokenManager.validateToken.mockResolvedValue(mockTokenStatus);

      const account = await accountManager.validateAccount(mockEmail);
      expect(account.email).toBe(mockEmail);
      expect(account.auth_status?.valid).toBe(true);
    });

    it('should create and validate new account if not exists', async () => {
      const mockTokenStatus = {
        valid: false,
        reason: 'No token found',
      };

      // Setup empty accounts data
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ accounts: [] }));
      await accountManager.loadAccounts();

      mockTokenManager.validateToken.mockResolvedValue(mockTokenStatus);

      const account = await accountManager.validateAccount(
        mockEmail,
        mockCategory,
        mockDescription
      );

      expect(account.email).toBe(mockEmail);
      expect(account.category).toBe(mockCategory);
      expect(account.description).toBe(mockDescription);
      expect(account.auth_status?.valid).toBe(false);
      expect(account.auth_status?.reason).toBe('No token found');
    });

    it('should throw error if account not found and missing category/description', async () => {
      // Setup empty accounts data
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ accounts: [] }));
      await accountManager.loadAccounts();

      await expect(accountManager.validateAccount(mockEmail))
        .rejects
        .toThrow('Account not found');
    });
  });

  describe('token operations', () => {
    const mockEmail = 'test@example.com';
    const mockAuthCode = 'mock-auth-code';
    const mockToken = { access_token: 'new-token' };

    it('should get token from auth code', async () => {
      mockOAuthClient.getTokenFromCode.mockResolvedValue(mockToken);

      const token = await accountManager.getTokenFromCode(mockAuthCode);
      expect(token).toEqual(mockToken);
      expect(mockOAuthClient.getTokenFromCode).toHaveBeenCalledWith(mockAuthCode);
    });

    it('should save token for account', async () => {
      await accountManager.saveToken(mockEmail, mockToken);
      expect(mockTokenManager.saveToken).toHaveBeenCalledWith(mockEmail, mockToken);
    });

    it('should validate token', async () => {
      const mockTokenStatus = {
        valid: true,
        token: mockToken,
      };

      mockTokenManager.validateToken.mockResolvedValue(mockTokenStatus);

      const status = await accountManager.validateToken(mockEmail);
      expect(status).toEqual(mockTokenStatus);
      expect(mockTokenManager.validateToken).toHaveBeenCalledWith(mockEmail);
    });
  });
});
