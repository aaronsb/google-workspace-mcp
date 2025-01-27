import fs from 'fs/promises';
import path from 'path';
import { AccountError, TokenStatus } from './types.js';
import { GoogleOAuthClient } from './oauth.js';

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
    const hasAllScopes = requiredScopes.every(scope => 
      tokenScopes.includes(scope)
    );

    if (!hasAllScopes) {
      const authUrl = await this.getAuthUrl(requiredScopes);
      return {
        valid: false,
        reason: 'Additional permissions required.',
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
