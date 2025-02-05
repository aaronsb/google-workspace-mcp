import fs from 'fs/promises';
import path from 'path';
import { AccountError, TokenStatus } from './types.js';
import { scopeRegistry } from '../tools/scope-registry.js';
import { GoogleOAuthClient } from './oauth.js';
import logger from '../../utils/logger.js';

/**
 * Manages OAuth token operations.
 * Focuses on basic token storage, retrieval, and refresh.
 * Auth issues are handled via 401 responses rather than pre-validation.
 */
export class TokenManager {
  private readonly credentialsPath: string;
  private oauthClient?: GoogleOAuthClient;

  constructor(oauthClient?: GoogleOAuthClient) {
    this.credentialsPath = process.env.CREDENTIALS_DIR || path.resolve('config', 'credentials');
    this.oauthClient = oauthClient;
  }

  setOAuthClient(client: GoogleOAuthClient) {
    this.oauthClient = client;
  }

  private getTokenPath(email: string): string {
    const sanitizedEmail = email.replace(/[^a-zA-Z0-9]/g, '-');
    return path.join(this.credentialsPath, `${sanitizedEmail}.token.json`);
  }

  async saveToken(email: string, tokenData: any): Promise<void> {
    logger.info(`Saving token for account: ${email}`);
    try {
      // Ensure base credentials directory exists
      await fs.mkdir(this.credentialsPath, { recursive: true });
      const tokenPath = this.getTokenPath(email);
      await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
      logger.debug(`Token saved successfully at: ${tokenPath}`);
    } catch (error) {
      throw new AccountError(
        'Failed to save token',
        'TOKEN_SAVE_ERROR',
        'Please ensure the credentials directory is writable'
      );
    }
  }

  async loadToken(email: string): Promise<any> {
    logger.debug(`Loading token for account: ${email}`);
    try {
      // First try loading from file
      const tokenPath = this.getTokenPath(email);
      try {
        const data = await fs.readFile(tokenPath, 'utf-8');
        return JSON.parse(data);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          // File doesn't exist, try environment variable
          logger.debug('Token file not found, checking environment variable');
          const envKey = `GOOGLE_TOKEN_${email.replace(/[@.]/g, '_').toUpperCase()}`;
          const envToken = process.env[envKey];
          if (envToken) {
            logger.info('Found token in environment variable, saving to file');
            const tokenData = JSON.parse(Buffer.from(envToken, 'base64').toString());
            // Save to file for future use
            await this.saveToken(email, tokenData);
            return tokenData;
          }
          logger.debug('No token found in environment variable');
          return null;
        }
        throw error;
      }
    } catch (error) {
      throw new AccountError(
        'Failed to load token',
        'TOKEN_LOAD_ERROR',
        'Please ensure the token file exists and is readable'
      );
    }
  }

  async deleteToken(email: string): Promise<void> {
    logger.info(`Deleting token for account: ${email}`);
    try {
      const tokenPath = this.getTokenPath(email);
      await fs.unlink(tokenPath);
      logger.debug('Token file deleted successfully');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        throw new AccountError(
          'Failed to delete token',
          'TOKEN_DELETE_ERROR',
          'Please ensure you have permission to delete the token file'
        );
      }
    }
  }

  /**
   * Basic token validation - just checks if token exists and isn't expired.
   * No scope validation - auth issues handled via 401 responses.
   */
  async validateToken(email: string): Promise<TokenStatus> {
    logger.debug(`Validating token for account: ${email}`);
    const token = await this.loadToken(email);
    
    if (!token) {
      logger.debug('No token found');
      return {
        valid: false,
        reason: 'No token found'
      };
    }

    if (token.expiry_date && token.expiry_date < Date.now()) {
      logger.debug('Token has expired, attempting refresh');
      if (token.refresh_token && this.oauthClient) {
        try {
          const newToken = await this.oauthClient.refreshToken(token.refresh_token);
          await this.saveToken(email, newToken);
          logger.info('Token refreshed successfully');
          return {
            valid: true,
            token: newToken
          };
        } catch (error) {
          logger.error('Token refresh failed', error as Error);
          return {
            valid: false,
            reason: 'Token refresh failed'
          };
        }
      }
      logger.debug('No refresh token available');
      return {
        valid: false,
        reason: 'Token expired'
      };
    }

    logger.debug('Token is valid');
    return {
      valid: true,
      token
    };
  }
}
