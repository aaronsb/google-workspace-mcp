import fs from 'fs/promises';
import path from 'path';
import { TokenData, GoogleApiError } from '../types.js';

const ENV_PREFIX = 'GOOGLE_TOKEN_';

export class TokenManager {
  private readonly credentialsDir: string;
  private readonly envTokens: Map<string, TokenData>;

  constructor() {
    this.credentialsDir = path.resolve('config', 'credentials');
    this.envTokens = new Map();
    this.loadEnvTokens();
  }

  private loadEnvTokens(): void {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(ENV_PREFIX) && value) {
        try {
          const email = key
            .slice(ENV_PREFIX.length)
            .toLowerCase()
            .replace(/_/g, '.');
          const tokenData = JSON.parse(
            Buffer.from(value, 'base64').toString()
          ) as TokenData;
          this.envTokens.set(email, tokenData);
        } catch (error) {
          console.warn(`Failed to parse token from env var ${key}:`, error);
        }
      }
    }
  }

  private getTokenPath(email: string): string {
    const sanitizedEmail = email.replace(/[@.]/g, '-');
    return path.join(this.credentialsDir, `${sanitizedEmail}.token.json`);
  }

  private updateEnvToken(email: string, tokenData: TokenData): void {
    const safeEmail = email.replace(/[@.]/g, '_').toUpperCase();
    process.env[`${ENV_PREFIX}${safeEmail}`] = Buffer.from(
      JSON.stringify(tokenData)
    ).toString('base64');
    this.envTokens.set(email, tokenData);
  }

  async saveToken(email: string, tokenData: TokenData): Promise<void> {
    try {
      // Save to file system
      const tokenPath = this.getTokenPath(email);
      await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
      
      // Update environment variable
      this.updateEnvToken(email, tokenData);
    } catch (error) {
      throw new GoogleApiError(
        'Failed to save token',
        'TOKEN_SAVE_ERROR',
        'Please ensure the credentials directory is writable'
      );
    }
  }

  async loadToken(email: string): Promise<TokenData | null> {
    // First try to load from environment variables
    const envToken = this.envTokens.get(email);
    if (envToken) {
      return envToken;
    }

    // Fall back to file system
    try {
      const tokenPath = this.getTokenPath(email);
      const data = await fs.readFile(tokenPath, 'utf-8');
      const token = JSON.parse(data) as TokenData;
      
      // Update environment variable for future use
      this.updateEnvToken(email, token);
      
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new GoogleApiError(
        'Failed to load token',
        'TOKEN_LOAD_ERROR',
        'Token file may be corrupted or inaccessible'
      );
    }
  }

  async deleteToken(email: string): Promise<void> {
    try {
      // Remove from file system
      const tokenPath = this.getTokenPath(email);
      await fs.unlink(tokenPath);
      
      // Remove from environment
      const safeEmail = email.replace(/[@.]/g, '_').toUpperCase();
      delete process.env[`${ENV_PREFIX}${safeEmail}`];
      this.envTokens.delete(email);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new GoogleApiError(
          'Failed to delete token',
          'TOKEN_DELETE_ERROR',
          'Please ensure you have permission to delete the token file'
        );
      }
    }
  }

  isTokenExpired(tokenData: TokenData): boolean {
    // Consider token expired 5 minutes before actual expiry
    const expiryBuffer = 5 * 60 * 1000; // 5 minutes in milliseconds
    return Date.now() >= tokenData.expiry_date - expiryBuffer;
  }

  hasRequiredScopes(tokenData: TokenData, requiredScopes: string[]): boolean {
    const tokenScopes = new Set(tokenData.scope.split(' '));
    return requiredScopes.every(scope => tokenScopes.has(scope));
  }

  async validateToken(email: string, requiredScopes: string[]): Promise<{
    valid: boolean;
    token?: TokenData;
    reason?: string;
  }> {
    const token = await this.loadToken(email);
    
    if (!token) {
      return { valid: false, reason: 'Token not found' };
    }

    if (this.isTokenExpired(token)) {
      return { valid: false, token, reason: 'Token expired' };
    }

    if (!this.hasRequiredScopes(token, requiredScopes)) {
      return { valid: false, reason: 'Insufficient scopes' };
    }

    return { valid: true, token };
  }
}
