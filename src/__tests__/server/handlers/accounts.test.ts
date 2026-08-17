import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction, type Mock } from 'vitest';

import { handleAccounts } from '../../../server/handlers/accounts.js';

// Mock dependencies
vi.mock('../../../accounts/registry.js');
vi.mock('../../../accounts/auth.js');
vi.mock('../../../accounts/token-service.js');
// Mocked so the confirmation gate can be exercised in BOTH directions. Every real
// service has a read-only scope today, so nothing produces stillAllowWrites on its own —
// the gate exists for the service that does not, and that is what is simulated here.
vi.mock('../../../accounts/oauth.js', () => ({
  ALL_SERVICES: 'gmail,drive,calendar,sheets,docs,tasks,slides,meet',
  scopesForServices: vi.fn(() => ({ scopes: [], stillAllowWrites: [] })),
}));

import { listAccounts, removeAccount, authenticateAndAddAccount } from '../../../accounts/registry.js';
import { checkAccountStatus, reauthWithServices } from '../../../accounts/auth.js';
import { getAccessToken, invalidateToken } from '../../../accounts/token-service.js';
import { scopesForServices } from '../../../accounts/oauth.js';

const mockListAccounts = listAccounts as MockedFunction<typeof listAccounts>;
const mockRemoveAccount = removeAccount as MockedFunction<typeof removeAccount>;
const mockCheckStatus = checkAccountStatus as MockedFunction<typeof checkAccountStatus>;
const mockReauth = reauthWithServices as MockedFunction<typeof reauthWithServices>;
const mockGetAccessToken = getAccessToken as MockedFunction<typeof getAccessToken>;
const mockInvalidateToken = invalidateToken as MockedFunction<typeof invalidateToken>;
const mockScopes = scopesForServices as MockedFunction<typeof scopesForServices>;

/** Pretend the named services have no read-only option. */
function noReadOnlyFor(...services: string[]) {
  mockScopes.mockReturnValue({ scopes: [], stillAllowWrites: services });
}

describe('handleAccounts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: everything can be read-only, so the gate stays out of the way.
    mockScopes.mockReturnValue({ scopes: [], stillAllowWrites: [] });
  });

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
      access: 'readwrite' as const,
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
      access: 'readwrite' as const,
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
    it('invalidates cache and re-fetches token', async () => {
      mockGetAccessToken.mockResolvedValue('fresh-token');

      const result = await handleAccounts({ operation: 'refresh', email: 'a@test.com' });

      expect(result.text).toContain('Token refreshed for a@test.com');
      expect(result.refs.status).toBe('refreshed');
      expect(mockInvalidateToken).toHaveBeenCalledWith('a@test.com');
      expect(mockGetAccessToken).toHaveBeenCalledWith('a@test.com');
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

    afterEach(() => {
      process.env = originalEnv;
    });

    it('re-authenticates with specified services', async () => {
      mockReauth.mockResolvedValue({ status: 'success', account: 'a@test.com' });

      const result = await handleAccounts({ operation: 'scopes', email: 'a@test.com', services: 'gmail,drive' });

      expect(result.text).toContain('Scopes updated');
      expect(result.text).toContain('gmail,drive');
      // Defaults to full access when `access` is not given, so an existing caller
      // authorizes exactly what it always did.
      expect(mockReauth).toHaveBeenCalledWith('test-id', 'test-secret', 'gmail,drive', 'readwrite');
    });

    it('asks for read-only scopes when access is read', async () => {
      mockReauth.mockResolvedValue({ status: 'success', account: 'a@test.com', access: 'read', stillAllowWrites: [] });

      const result = await handleAccounts({
        operation: 'scopes', email: 'a@test.com', services: 'gmail,drive', access: 'read',
      });

      expect(mockReauth).toHaveBeenCalledWith('test-id', 'test-secret', 'gmail,drive', 'read');
      expect(result.text).toContain('read-only');
    });

    it('stops before the browser when a service has no read-only option', async () => {
      // Authorizing first and reporting after would leave a token that can write,
      // revocable only through Google's own settings page.
      noReadOnlyFor('meet');
      const result = await handleAccounts({
        operation: 'scopes', email: 'a@test.com', services: 'gmail,meet', access: 'read',
      });

      expect(mockReauth).not.toHaveBeenCalled();
      expect(result.refs.status).toBe('needs-confirmation');
      expect(result.refs.stillAllowWrites).toEqual(['meet']);
      expect(result.text).toContain('no read-only permission for');
      expect(result.text).toContain('meet');
      expect(result.text).toContain('Nothing has been authorized yet');
      // Both ways out are spelled for the caller.
      expect(result.text).toContain('confirmWriteAccess');
      expect(result.text).toContain('Leave meet out of');
    });

    it('proceeds once the caller confirms', async () => {
      noReadOnlyFor('meet');
      mockReauth.mockResolvedValue({
        status: 'success', account: 'a@test.com', access: 'read', stillAllowWrites: ['meet'],
      });

      const result = await handleAccounts({
        operation: 'scopes', email: 'a@test.com', services: 'gmail,meet',
        access: 'read', confirmWriteAccess: true,
      });

      expect(mockReauth).toHaveBeenCalledWith('test-id', 'test-secret', 'gmail,meet', 'read');
      // …and the response still says what was actually granted.
      expect(result.text).toContain('meet had no read-only option');
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
