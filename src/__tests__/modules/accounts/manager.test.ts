import { AccountManager } from '../../../modules/accounts/manager.js';
import { mockAccounts, mockTokens } from '../../../__fixtures__/accounts.js';

// Simple mocks for token and oauth
jest.mock('../../../modules/accounts/token.js', () => ({
  TokenManager: jest.fn().mockImplementation(() => ({
    validateToken: jest.fn().mockResolvedValue({ valid: true }),
    saveToken: jest.fn().mockResolvedValue(undefined),
    deleteToken: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('../../../modules/accounts/oauth.js', () => ({
  GoogleOAuthClient: jest.fn().mockImplementation(() => ({
    ensureInitialized: jest.fn().mockResolvedValue(undefined),
    getTokenFromCode: jest.fn().mockResolvedValue(mockTokens.valid),
    refreshToken: jest.fn().mockResolvedValue(mockTokens.valid)
  }))
}));

// Simple file system mock
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('path', () => ({
  resolve: jest.fn().mockReturnValue('/mock/accounts.json'),
  dirname: jest.fn().mockReturnValue('/mock')
}));

describe('AccountManager', () => {
  let accountManager: AccountManager;
  const fs = require('fs/promises');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.ACCOUNTS_FILE = '/mock/accounts.json';
    // Default successful file read
    fs.readFile.mockResolvedValue(JSON.stringify(mockAccounts));
    
    // Reset TokenManager mock to default implementation
    const TokenManager = require('../../../modules/accounts/token.js').TokenManager;
    TokenManager.mockImplementation(() => ({
      validateToken: jest.fn().mockResolvedValue({ valid: true }),
      saveToken: jest.fn().mockResolvedValue(undefined),
      deleteToken: jest.fn().mockResolvedValue(undefined)
    }));
    
    accountManager = new AccountManager();
  });

  // Basic account operations
  describe('account operations', () => {
    it('should load accounts from file', async () => {
      await accountManager.initialize();
      const accounts = await accountManager.listAccounts();
      
      expect(accounts).toHaveLength(mockAccounts.accounts.length);
      expect(accounts[0].email).toBe(mockAccounts.accounts[0].email);
    });

    it('should add new account', async () => {
      await accountManager.initialize();
      const newAccount = await accountManager.addAccount(
        'new@example.com',
        'work',
        'New Test Account'
      );

      expect(newAccount.email).toBe('new@example.com');
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should not add duplicate account', async () => {
      await accountManager.initialize();
      await expect(accountManager.addAccount(
        mockAccounts.accounts[0].email,
        'work',
        'Duplicate'
      )).rejects.toThrow('Account already exists');
    });
  });

  // File system operations
  describe('file operations', () => {
    it('should handle missing accounts file', async () => {
      // Reset all mocks and modules
      jest.clearAllMocks();
      jest.resetModules();
      
      // Re-require fs after reset
      const fs = require('fs/promises');
      
      // Setup error for first read attempt
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      fs.readFile.mockRejectedValueOnce(error);
      
      // Mock path module
      jest.doMock('path', () => ({
        resolve: jest.fn().mockReturnValue('/mock/accounts.json'),
        dirname: jest.fn().mockReturnValue('/mock')
      }));
      
      // Re-require AccountManager to use fresh mocks
      const { AccountManager } = require('../../../modules/accounts/manager.js');
      accountManager = new AccountManager();
      
      // Initialize with empty file system
      await accountManager.initialize();
      
      // Mock empty response for listAccounts call
      fs.readFile.mockResolvedValueOnce('{"accounts":[]}');
      const accounts = await accountManager.listAccounts();
      
      // Verify results
      expect(accounts).toHaveLength(0);
      
      // Verify write was called with correct data
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const [path, content] = fs.writeFile.mock.calls[0];
      expect(path).toBe('/mock/accounts.json');
      
      // Parse and re-stringify to normalize formatting
      const parsedContent = JSON.parse(content);
      expect(parsedContent).toEqual({ accounts: [] });
    });

    it('should handle invalid JSON', async () => {
      fs.readFile.mockResolvedValueOnce('invalid json');
      
      await expect(accountManager.initialize())
        .rejects
        .toThrow('Failed to parse accounts configuration');
    });
  });

  // Token validation (simplified)
  describe('token validation', () => {
    const testEmail = mockAccounts.accounts[0].email;

    it('should validate token with simple success', async () => {
      await accountManager.initialize();
      const account = await accountManager.validateAccount(testEmail);
      
      expect(account.email).toBe(testEmail);
      expect(account.auth_status?.valid).toBe(true);
    });

    it('should handle token validation failure', async () => {
      // Reset all mocks and modules
      jest.clearAllMocks();
      jest.resetModules();
      
      // Re-require fs and setup fresh state
      const fs = require('fs/promises');
      fs.readFile.mockResolvedValue(JSON.stringify(mockAccounts));
      
      // Create mock implementation
      const mockValidateToken = jest.fn().mockResolvedValue({ 
        valid: false, 
        reason: 'Token expired' 
      });
      
      // Setup TokenManager with tracked mock
      jest.doMock('../../../modules/accounts/token.js', () => ({
        TokenManager: jest.fn().mockImplementation(() => ({
          validateToken: mockValidateToken,
          saveToken: jest.fn(),
          deleteToken: jest.fn()
        }))
      }));
      
      // Re-require AccountManager to use new mocks
      const { AccountManager } = require('../../../modules/accounts/manager.js');
      accountManager = new AccountManager();
      await accountManager.initialize();
      
      const account = await accountManager.validateAccount(testEmail);
      
      expect(mockValidateToken).toHaveBeenCalledWith(testEmail);
      expect(account.auth_status?.valid).toBe(false);
      expect(account.auth_status?.reason).toBe('Token expired');
    });
  });

  // OAuth operations (simplified)
  describe('oauth operations', () => {
    it('should handle token from auth code', async () => {
      await accountManager.initialize();
      const token = await accountManager.getTokenFromCode('test-code');
      
      expect(token).toEqual(mockTokens.valid);
    });

    it('should save token for account', async () => {
      // Reset all mocks and modules
      jest.clearAllMocks();
      jest.resetModules();
      
      // Re-require fs and setup fresh state
      const fs = require('fs/promises');
      fs.readFile.mockResolvedValue(JSON.stringify(mockAccounts));
      
      // Create mock implementation
      const mockSaveToken = jest.fn().mockResolvedValue(undefined);
      
      // Setup TokenManager with tracked mock
      jest.doMock('../../../modules/accounts/token.js', () => ({
        TokenManager: jest.fn().mockImplementation(() => ({
          validateToken: jest.fn().mockResolvedValue({ valid: true }),
          saveToken: mockSaveToken,
          deleteToken: jest.fn()
        }))
      }));
      
      // Re-require AccountManager to use new mocks
      const { AccountManager } = require('../../../modules/accounts/manager.js');
      accountManager = new AccountManager();
      await accountManager.initialize();
      
      const testEmail = 'test@example.com';
      await accountManager.saveToken(testEmail, mockTokens.valid);
      
      expect(mockSaveToken).toHaveBeenCalledWith(testEmail, mockTokens.valid);
      expect(mockSaveToken).toHaveBeenCalledTimes(1);
    });
  });
});
