import fs from 'fs/promises';
import path from 'path';
import { AccountError, TokenStatus } from './types.js';
import { scopeRegistry } from '../tools/scope-registry.js';
import { GoogleOAuthClient } from './oauth.js';

/**
 * Manages OAuth token operations with integrated scope validation.
 * 
 * The TokenManager works in conjunction with the ScopeRegistry to ensure
 * that tokens have the correct permissions for all operations. This is
 * particularly important for:
 * 
 * 1. Gmail Operations:
 *    - Prevents metadata-only scope issues
 *    - Ensures proper search and full content access
 * 
 * 2. Calendar Operations:
 *    - Validates event management permissions
 *    - Ensures proper access levels for calendar features
 * 
 * Token validation includes checking both expiration and scope coverage,
 * triggering re-authentication when necessary to obtain proper permissions.
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
    try {
      const tokenPath = this.getTokenPath(email);
      await fs.mkdir(path.dirname(tokenPath), { recursive: true });
      await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
    } catch (error) {
      throw new AccountError(
        'Failed to save token',
        'TOKEN_SAVE_ERROR',
        'Please ensure the credentials directory is writable'
      );
    }
  }

  async loadToken(email: string): Promise<any> {
    try {
      const tokenPath = this.getTokenPath(email);
      const data = await fs.readFile(tokenPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw new AccountError(
        'Failed to load token',
        'TOKEN_LOAD_ERROR',
        'Please ensure the token file exists and is readable'
      );
    }
  }

  async deleteToken(email: string): Promise<void> {
    try {
      const tokenPath = this.getTokenPath(email);
      await fs.unlink(tokenPath);
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
   * Validates a token's expiration and scope coverage.
   * 
   * This method performs comprehensive token validation:
   * 1. Checks if token exists
   * 2. Verifies token expiration
   * 3. Validates scope coverage using ScopeRegistry
   * 
   * For Gmail operations, this ensures the token has proper scopes to:
   * - Perform searches with 'q' parameter
   * - Access full email content
   * - Manage email settings
   * 
   * For Calendar operations, it verifies:
   * - Event viewing/management permissions
   * - Settings access rights
   * 
   * @param email - The email address associated with the token
   * @param requiredScopes - Array of required OAuth scopes
   * @returns TokenStatus object indicating validity and any issues
   */
  async validateToken(email: string, requiredScopes: string[]): Promise<TokenStatus> {
    const token = await this.loadToken(email);
    
    if (!token) {
      const authUrl = await this.getAuthUrl(requiredScopes);
      return {
        valid: false,
        reason: 'No token found. Authentication required.',
        authUrl,
        requiredScopes
      };
    }

    // Check if token is expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      const authUrl = await this.getAuthUrl(requiredScopes);
      return {
        valid: false,
        token,
        reason: 'Token expired. Re-authentication required.',
        authUrl,
        requiredScopes
      };
    }

    // Check if token has required scopes
    const tokenScopes = token.scope.split(' ');
    try {
      scopeRegistry.validateScopes(tokenScopes);
    } catch (error) {
      const authUrl = await this.getAuthUrl(requiredScopes);
      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'Additional permissions required.',
        authUrl,
        requiredScopes
      };
    }

    return {
      valid: true,
      token
    };
  }

  private async getAuthUrl(scopes: string[]): Promise<string | undefined> {
    if (!this.oauthClient) {
      throw new AccountError(
        'OAuth client not configured',
        'AUTH_CLIENT_ERROR',
        'Please ensure the OAuth client is properly initialized'
      );
    }
    return this.oauthClient.generateAuthUrl(scopes);
  }

  /**
   * Gets the current status of a token without full scope validation.
   * 
   * This is a lightweight check that:
   * 1. Verifies token existence
   * 2. Checks expiration
   * 
   * Unlike validateToken, this doesn't perform scope validation,
   * making it suitable for quick token presence checks.
   * 
   * @param email - The email address associated with the token
   * @returns TokenStatus object with basic validity information
   */
  async getTokenStatus(email: string): Promise<TokenStatus> {
    const token = await this.loadToken(email);
    
    if (!token) {
      return {
        valid: false,
        reason: 'No token found'
      };
    }

    if (token.expiry_date && token.expiry_date < Date.now()) {
      return {
        valid: false,
        token,
        reason: 'Token expired'
      };
    }

    return {
      valid: true,
      token
    };
  }
}
