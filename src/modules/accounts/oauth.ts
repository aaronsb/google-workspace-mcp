import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import { AccountError } from './types.js';

export class GoogleOAuthClient {
  private oauth2Client?: OAuth2Client;
  private readonly authConfigPath: string;

  constructor() {
    this.authConfigPath = process.env.AUTH_CONFIG_FILE || path.resolve('config', 'gauth.json');
  }

  async ensureInitialized(): Promise<void> {
    if (!this.oauth2Client) {
      const config = await this.loadAuthConfig();
      this.oauth2Client = new OAuth2Client(
        config.client_id,
        config.client_secret,
        config.redirect_uri
      );
    }
  }

  private async loadAuthConfig(): Promise<{
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  }> {
    try {
      const data = await fs.readFile(this.authConfigPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      throw new AccountError(
        'Failed to load OAuth configuration',
        'AUTH_CONFIG_ERROR',
        'Please ensure gauth.json exists and contains valid credentials'
      );
    }
  }

  async getAuthClient(): Promise<OAuth2Client> {
    await this.ensureInitialized();
    if (!this.oauth2Client) {
      throw new AccountError(
        'OAuth client not initialized',
        'AUTH_CLIENT_ERROR',
        'Please ensure the OAuth client is properly initialized'
      );
    }
    return this.oauth2Client;
  }

  async generateAuthUrl(scopes: string[]): Promise<string> {
    await this.ensureInitialized();
    return this.oauth2Client!.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async getTokenFromCode(code: string): Promise<any> {
    await this.ensureInitialized();
    try {
      const { tokens } = await this.oauth2Client!.getToken(code);
      return tokens;
    } catch (error) {
      throw new AccountError(
        'Failed to exchange authorization code for tokens',
        'AUTH_CODE_ERROR',
        'Please ensure the authorization code is valid and not expired'
      );
    }
  }

  async refreshToken(refreshToken: string): Promise<any> {
    await this.ensureInitialized();
    try {
      this.oauth2Client!.setCredentials({
        refresh_token: refreshToken
      });
      const { credentials } = await this.oauth2Client!.refreshAccessToken();
      return credentials;
    } catch (error) {
      throw new AccountError(
        'Failed to refresh token',
        'TOKEN_REFRESH_ERROR',
        'Please re-authenticate the account'
      );
    }
  }
}
