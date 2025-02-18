import { TokenManager } from '../../../modules/accounts/token.js';
import { GoogleOAuthClient } from '../../../modules/accounts/oauth.js';

jest.mock('../../../modules/accounts/oauth.js');
jest.mock('../../../utils/logger.js');

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockOAuthClient: jest.Mocked<GoogleOAuthClient>;

  beforeEach(() => {
    mockOAuthClient = new GoogleOAuthClient() as jest.Mocked<GoogleOAuthClient>;
    tokenManager = new TokenManager(mockOAuthClient);

    // Mock filesystem operations
    jest.spyOn(tokenManager as any, 'loadToken').mockImplementation(async () => null);
    jest.spyOn(tokenManager as any, 'saveToken').mockImplementation(async () => {});
  });

  describe('autoRenewToken', () => {
    it('should return valid status for non-expired token', async () => {
      const validToken = {
        access_token: 'valid_token',
        refresh_token: 'refresh_token',
        expiry_date: Date.now() + 3600000 // 1 hour from now
      };

      (tokenManager as any).loadToken.mockResolvedValue(validToken);

      const result = await tokenManager.autoRenewToken('test@example.com');
      expect(result.success).toBe(true);
      expect(result.status).toBe('VALID');
      expect(result.token).toBe(validToken);
    });

    it('should attempt refresh for expired token', async () => {
      const expiredToken = {
        access_token: 'expired_token',
        refresh_token: 'refresh_token',
        expiry_date: Date.now() - 3600000 // 1 hour ago
      };

      const newToken = {
        access_token: 'new_token',
        refresh_token: 'refresh_token',
        expiry_date: Date.now() + 3600000
      };

      (tokenManager as any).loadToken.mockResolvedValue(expiredToken);
      mockOAuthClient.refreshToken.mockResolvedValue(newToken);

      const result = await tokenManager.autoRenewToken('test@example.com');
      expect(result.success).toBe(true);
      expect(result.status).toBe('REFRESHED');
      expect(result.token).toBe(newToken);
    });

    it('should handle invalid refresh token', async () => {
      const expiredToken = {
        access_token: 'expired_token',
        refresh_token: 'invalid_refresh_token',
        expiry_date: Date.now() - 3600000
      };

      (tokenManager as any).loadToken.mockResolvedValue(expiredToken);
      mockOAuthClient.refreshToken.mockRejectedValue(new Error('invalid_grant'));

      const result = await tokenManager.autoRenewToken('test@example.com');
      expect(result.success).toBe(false);
      expect(result.status).toBe('REFRESH_FAILED');
      expect(result.canRetry).toBe(false);
    });

    it('should handle temporary refresh failures', async () => {
      const expiredToken = {
        access_token: 'expired_token',
        refresh_token: 'refresh_token',
        expiry_date: Date.now() - 3600000
      };

      (tokenManager as any).loadToken.mockResolvedValue(expiredToken);
      mockOAuthClient.refreshToken.mockRejectedValue(new Error('network_error'));

      const result = await tokenManager.autoRenewToken('test@example.com');
      expect(result.success).toBe(false);
      expect(result.status).toBe('REFRESH_FAILED');
      expect(result.canRetry).toBe(true);
    });

    it('should handle missing token', async () => {
      (tokenManager as any).loadToken.mockResolvedValue(null);

      const result = await tokenManager.autoRenewToken('test@example.com');
      expect(result.success).toBe(false);
      expect(result.status).toBe('NO_TOKEN');
    });
  });
});
