import fs from 'fs/promises';
import path from 'path';
import { AccountError, TokenStatus } from './types.js';

export class TokenManager {
  private readonly credentialsPath: string;

  constructor() {
    this.credentialsPath = process.env.CREDENTIALS_DIR || path.resolve('config', 'credentials');
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
      return {
        valid: false,
        reason: 'No token found'
      };
    }

    // Check if token is expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      return {
        valid: false,
        token,
        reason: 'Token expired'
      };
    }

    // Check if token has required scopes
    const tokenScopes = token.scope.split(' ');
    const hasAllScopes = requiredScopes.every(scope => 
      tokenScopes.includes(scope)
    );

    if (!hasAllScopes) {
      return {
        valid: false,
        reason: 'Missing required scopes'
      };
    }

    return {
      valid: true,
      token
    };
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
