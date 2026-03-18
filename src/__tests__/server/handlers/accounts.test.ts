import { handleAccounts } from '../../../server/handlers/accounts.js';

// Mock dependencies
jest.mock('../../../accounts/registry.js');
jest.mock('../../../accounts/auth.js');
jest.mock('../../../accounts/credentials.js');

import { listAccounts, removeAccount, authenticateAndAddAccount } from '../../../accounts/registry.js';
import { checkAccountStatus, reauthWithServices } from '../../../accounts/auth.js';
import { exportAndSaveCredential } from '../../../accounts/credentials.js';

const mockListAccounts = listAccounts as jest.MockedFunction<typeof listAccounts>;
const mockRemoveAccount = removeAccount as jest.MockedFunction<typeof removeAccount>;
const mockCheckStatus = checkAccountStatus as jest.MockedFunction<typeof checkAccountStatus>;
const mockReauth = reauthWithServices as jest.MockedFunction<typeof reauthWithServices>;
const mockExportCred = exportAndSaveCredential as jest.MockedFunction<typeof exportAndSaveCredential>;

describe('handleAccounts', () => {
  beforeEach(() => jest.resetAllMocks());

  describe('list', () => {
    it('returns markdown account list', async () => {
      mockListAccounts.mockResolvedValue([
        { email: 'a@test.com', category: 'personal', hasCredential: true } as any,
        { email: 'b@test.com', category: 'work', description: 'Work', hasCredential: false } as any,
      ]);

      const result = await handleAccounts({ operation: 'list' });

      expect(result.text).toContain('## Accounts (2)');
      expect(result.text).toContain('[x] a@test.com');
      expect(result.text).toContain('[ ] b@test.com');
      expect(result.text).toContain('Work');
      expect(result.refs.count).toBe(2);
    });

    it('returns empty message when no accounts', async () => {
      mockListAccounts.mockResolvedValue([]);

      const result = await handleAccounts({ operation: 'list' });

      expect(result.text).toContain('No accounts configured');
      expect(result.refs.count).toBe(0);
    });
  });

  describe('remove', () => {
    it('removes account and returns confirmation', async () => {
      mockRemoveAccount.mockResolvedValue(undefined);

      const result = await handleAccounts({ operation: 'remove', email: 'a@test.com' });

      expect(result.text).toContain('Account removed: a@test.com');
      expect(mockRemoveAccount).toHaveBeenCalledWith('a@test.com');
    });

    it('requires email', async () => {
      await expect(handleAccounts({ operation: 'remove' })).rejects.toThrow('email is required');
    });
  });

  describe('status', () => {
    it('returns formatted account status', async () => {
      mockCheckStatus.mockResolvedValue({
        email: 'a@test.com',
        tokenValid: true,
        scopes: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/drive'],
        scopeCount: 2,
        hasRefreshToken: true,
      });

      const result = await handleAccounts({ operation: 'status', email: 'a@test.com' });

      expect(result.text).toContain('## Account Status: a@test.com');
      expect(result.text).toContain('[x] Token valid');
      expect(result.text).toContain('[x] Has refresh token');
      expect(result.text).toContain('gmail.modify');
      expect(result.text).toContain('drive');
      expect(result.refs.tokenValid).toBe(true);
      expect(result.refs.scopeCount).toBe(2);
    });

    it('shows invalid token status', async () => {
      mockCheckStatus.mockResolvedValue({
        email: 'a@test.com',
        tokenValid: false,
        scopes: [],
        scopeCount: 0,
        hasRefreshToken: false,
      });

      const result = await handleAccounts({ operation: 'status', email: 'a@test.com' });

      expect(result.text).toContain('[ ] Token invalid');
      expect(result.text).toContain('[ ] No refresh token');
      expect(result.refs.tokenValid).toBe(false);
    });

    it('requires email', async () => {
      await expect(handleAccounts({ operation: 'status' })).rejects.toThrow('email is required');
    });
  });

  describe('refresh', () => {
    it('re-exports credentials and returns confirmation', async () => {
      mockExportCred.mockResolvedValue('/path/to/cred.json');

      const result = await handleAccounts({ operation: 'refresh', email: 'a@test.com' });

      expect(result.text).toContain('Credentials refreshed for a@test.com');
      expect(result.refs.status).toBe('refreshed');
      expect(mockExportCred).toHaveBeenCalledWith('a@test.com');
    });

    it('requires email', async () => {
      await expect(handleAccounts({ operation: 'refresh' })).rejects.toThrow('email is required');
    });
  });

  describe('scopes', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret' };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('re-authenticates with specified services', async () => {
      mockReauth.mockResolvedValue({ status: 'success', account: 'a@test.com' });

      const result = await handleAccounts({ operation: 'scopes', email: 'a@test.com', services: 'gmail,drive' });

      expect(result.text).toContain('Scopes updated');
      expect(result.text).toContain('gmail,drive');
      expect(mockReauth).toHaveBeenCalledWith('test-id', 'test-secret', 'gmail,drive');
    });

    it('requires email', async () => {
      await expect(handleAccounts({ operation: 'scopes', services: 'gmail' })).rejects.toThrow('email is required');
    });

    it('requires services', async () => {
      await expect(handleAccounts({ operation: 'scopes', email: 'a@test.com' })).rejects.toThrow('services is required');
    });
  });

  it('rejects unknown operation', async () => {
    await expect(handleAccounts({ operation: 'nope' })).rejects.toThrow('Unknown');
  });
});
