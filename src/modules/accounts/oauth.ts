import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import path from 'path';
import { AccountError } from './types.js';
import { Logger } from '../../utils/logger.js';

export class GoogleOAuthClient {
  private oauth2Client?: OAuth2Client;
  private readonly authConfigPath: string;

  constructor() {
    this.authConfigPath = process.env.AUTH_CONFIG_FILE || path.resolve('config', 'gauth.json');
  }

  async ensureInitialized(): Promise<void> {
    if (!this.oauth2Client) {
      Logger.info('Initializing OAuth client...');
      const config = await this.loadAuthConfig();
      this.oauth2Client = new OAuth2Client(
        config.client_id,
        config.client_secret,
        config.redirect_uri
      );
      Logger.info('OAuth client initialized successfully');
    }
  }

  private async loadAuthConfig(): Promise<{
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  }> {
    try {
      Logger.debug(`Loading auth config from: ${this.authConfigPath}`);
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.authConfigPath), { recursive: true });
      
      let data: string;
      try {
        data = await fs.readFile(this.authConfigPath, 'utf-8');
        Logger.debug('Successfully read auth config');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new AccountError(
            'OAuth configuration file not found',
            'AUTH_CONFIG_ERROR',
            'Please ensure gauth.json exists with valid credentials'
          );
        }
        throw error;
      }
      const config = JSON.parse(data);
      Logger.debug('Successfully parsed auth config');
      return config;
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

  /**
   * Generates the OAuth authorization URL
   * IMPORTANT: When using the generated URL, always use it exactly as returned.
   * Do not attempt to modify, reformat, or reconstruct the URL as this can break
   * the authentication flow. The URL contains carefully encoded parameters that
   * must be preserved exactly as provided.
   */
  async generateAuthUrl(scopes: string[]): Promise<string> {
    Logger.info('Generating OAuth authorization URL');
    await this.ensureInitialized();
    const url = this.oauth2Client!.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
    Logger.debug('Authorization URL generated successfully');
    return url;
  }

  async getTokenFromCode(code: string): Promise<any> {
    Logger.info('Exchanging authorization code for tokens');
    await this.ensureInitialized();
    try {
      const { tokens } = await this.oauth2Client!.getToken(code);
      Logger.info('Successfully obtained tokens from auth code');
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
    Logger.info('Refreshing access token');
    await this.ensureInitialized();
    try {
      this.oauth2Client!.setCredentials({
        refresh_token: refreshToken
      });
      const { credentials } = await this.oauth2Client!.refreshAccessToken();
      Logger.info('Successfully refreshed access token');
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
