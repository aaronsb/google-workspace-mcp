import { AccountManager } from '../../../modules/accounts/manager.js';
import { mockAccounts } from '../../../__fixtures__/accounts.js';
import { setupTestEnvironment } from '../../../__helpers__/testSetup.js';

jest.mock('../../../modules/accounts/token.js');
jest.mock('../../../modules/accounts/oauth.js');
jest.mock('fs/promises');
jest.mock('path');

describe('AccountManager', () => {
  const { fileSystem, accountManager: mocks } = setupTestEnvironment();
  let accountManager: AccountManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.ACCOUNTS_FILE = '/mock/accounts.json';
    accountManager = new AccountManager();
    await accountManager.initialize(); // Initialize before each test
  });

  describe('loadAccounts', () => {
    it('should load and parse accounts file', async () => {
      // Setup
      fileSystem.setMockFileContent(mockAccounts);

      // Execute
      await accountManager.loadAccounts();
      const accounts = await accountManager.listAccounts();
      
      // Verify
      expect(accounts).toHaveLength(mockAccounts.accounts.length);
      expect(accounts[0].email).toBe(mockAccounts.accounts[0].email);
      expect(accounts[1].email).toBe(mockAccounts.accounts[1].email);
    });

    it('should create empty accounts file if it does not exist', async () => {
      // Setup
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      fileSystem.fs.readFile.mockRejectedValueOnce(error);
      fileSystem.fs.readFile.mockResolvedValueOnce(JSON.stringify({ accounts: [] }));

      // Execute
      await accountManager.loadAccounts();
      const accounts = await accountManager.listAccounts();
      
      // Verify
      expect(accounts).toEqual([]);
      expect(fileSystem.fs.writeFile).toHaveBeenCalledWith(
        '/mock/accounts.json',
        JSON.stringify({ accounts: [] }, null, 2)
      );
    });
  });

  describe('validateAccount', () => {
    const testEmail = mockAccounts.accounts[0].email;
    const testCategory = mockAccounts.accounts[0].category;
    const testDescription = mockAccounts.accounts[0].description;

    beforeEach(async () => {
      fileSystem.setMockFileContent(mockAccounts);
      await accountManager.loadAccounts();
      mocks.mockTokenManager.validateToken.mockResolvedValue({ valid: true });
    });

    it('should validate existing account with valid token', async () => {
      // Execute
      const account = await accountManager.validateAccount(testEmail);

      // Verify
      expect(account.email).toBe(testEmail);
      expect(account.auth_status?.valid).toBe(true);
      expect(mocks.mockTokenManager.validateToken).toHaveBeenCalledWith(testEmail);
    });

    it('should create and validate new account if not exists', async () => {
      // Setup
      const newEmail = 'new@example.com';
      fileSystem.setMockFileContent({ accounts: [] });
      await accountManager.loadAccounts();

      // Execute
      const account = await accountManager.validateAccount(
        newEmail,
        testCategory,
        testDescription
      );

      // Verify
      expect(account.email).toBe(newEmail);
      expect(account.category).toBe(testCategory);
      expect(account.description).toBe(testDescription);
    });

    it('should throw error if account not found and missing category/description', async () => {
      // Setup
      fileSystem.setMockFileContent({ accounts: [] });
      await accountManager.loadAccounts();

      // Execute & Verify
      await expect(accountManager.validateAccount(testEmail))
        .rejects
        .toThrow('Account not found');
    });
  });

  describe('token operations', () => {
    const testEmail = mockAccounts.accounts[0].email;
    const testAuthCode = 'test-auth-code';
    const testToken = { access_token: 'test-token' };

    beforeEach(async () => {
      fileSystem.setMockFileContent(mockAccounts);
      await accountManager.loadAccounts();
      mocks.mockOAuthClient.getTokenFromCode.mockResolvedValue(testToken);
    });

    it('should get token from auth code', async () => {
      // Execute
      const token = await accountManager.getTokenFromCode(testAuthCode);

      // Verify
      expect(token).toEqual(testToken);
      expect(mocks.mockOAuthClient.getTokenFromCode).toHaveBeenCalledWith(testAuthCode);
    });

    it('should save token for account', async () => {
      // Execute
      await accountManager.saveToken(testEmail, testToken);

      // Verify
      expect(mocks.mockTokenManager.saveToken).toHaveBeenCalledWith(testEmail, testToken);
    });

    it('should validate token', async () => {
      // Setup
      mocks.mockTokenManager.validateToken.mockResolvedValue({ valid: true, token: testToken });

      // Execute
      const status = await accountManager.validateToken(testEmail);

      // Verify
      expect(status.valid).toBe(true);
      expect(mocks.mockTokenManager.validateToken).toHaveBeenCalledWith(testEmail);
    });
  });
});
