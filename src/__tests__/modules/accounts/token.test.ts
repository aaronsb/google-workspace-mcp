import { TokenManager } from '../../../modules/accounts/token.js';
import { GoogleOAuthClient } from '../../../modules/accounts/oauth.js';
import fs from 'fs/promises';
import path from 'path';

jest.mock('fs/promises');
jest.mock('path', () => ({
  join: jest.fn((dir, file) => `${dir}/${file}`),
  resolve: jest.fn((...args) => args.join('/')),
}));

describe('TokenManager', () => {
  const mockEmail = 'test@example.com';
  let tokenManager: TokenManager;
  let mockOAuthClient: jest.Mocked<GoogleOAuthClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CREDENTIALS_DIR = '/app/config/credentials';
    
    mockOAuthClient = {
      ensureInitialized: jest.fn().mockResolvedValue(undefined),
      getAuthClient: jest.fn().mockResolvedValue({}),
      generateAuthUrl: jest.fn().mockResolvedValue('https://mock-auth-url'),
      getTokenFromCode: jest.fn().mockResolvedValue({}),
      refreshToken: jest.fn(),
      loadAuthConfig: jest.fn()
    } as unknown as jest.Mocked<GoogleOAuthClient>;
    
    tokenManager = new TokenManager(mockOAuthClient);
  });

  describe('saveToken', () => {
    it('should save token to file', async () => {
      const mockToken = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600000
      };

      await tokenManager.saveToken(mockEmail, mockToken);

      expect(fs.mkdir).toHaveBeenCalledWith('/app/config/credentials', {
        recursive: true
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/app/config/credentials/test-example-com.token.json',
        JSON.stringify(mockToken, null, 2)
      );
    });
  });

  describe('loadToken', () => {
    it('should load and parse token file', async () => {
      const mockToken = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600000,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/gmail.modify'
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockToken));

      const token = await tokenManager.loadToken(mockEmail);
      expect(token).toEqual(mockToken);
      expect(fs.readFile).toHaveBeenCalledWith(
        '/app/config/credentials/test-example-com.token.json',
        'utf-8'
      );
    });

    it('should return null if token file does not exist', async () => {
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      (fs.readFile as jest.Mock).mockRejectedValue(error);

      const token = await tokenManager.loadToken(mockEmail);
      expect(token).toBeNull();
    });
  });

  describe('deleteToken', () => {
    it('should delete token file', async () => {
      await tokenManager.deleteToken(mockEmail);
      expect(fs.unlink).toHaveBeenCalledWith(
        '/app/config/credentials/test-example-com.token.json'
      );
    });

    it('should handle missing token file', async () => {
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      (fs.unlink as jest.Mock).mockRejectedValue(error);

      await expect(tokenManager.deleteToken(mockEmail)).resolves.toBeUndefined();
    });
  });

  describe('validateToken', () => {
    it('should return valid status for non-expired token', async () => {
      const mockToken = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600000,
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockToken));

      const status = await tokenManager.validateToken(mockEmail);
      expect(status).toEqual({
        valid: true,
        status: 'VALID',
        token: mockToken
      });
    });

    it('should attempt refresh for expired token', async () => {
      const expiredToken = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() - 3600000
      };

      const newToken = {
        access_token: 'new-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600000
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(expiredToken));
      mockOAuthClient.refreshToken.mockResolvedValue(newToken);

      const status = await tokenManager.validateToken(mockEmail);
      expect(status).toEqual({
        valid: true,
        status: 'REFRESHED',
        token: newToken
      });
      expect(mockOAuthClient.refreshToken).toHaveBeenCalledWith('mock-refresh-token');
    });

    it('should return invalid status when no token exists', async () => {
      const error = new Error('File not found');
      (error as any).code = 'ENOENT';
      (fs.readFile as jest.Mock).mockRejectedValue(error);

      const status = await tokenManager.validateToken(mockEmail);
      expect(status).toEqual({
        valid: false,
        status: 'NO_TOKEN',
        reason: 'No token found'
      });
    });
  });
});
