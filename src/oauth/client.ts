import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { OAuthConfig, TokenData, GoogleApiError } from '../types.js';

export class GoogleOAuthClient {
  private client?: OAuth2Client;
  private config?: OAuthConfig;
  private initializationPromise?: Promise<void>;

  async ensureInitialized(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.loadConfig().catch(error => {
        // Clear the promise so we can retry initialization
        this.initializationPromise = undefined;
        throw error;
      });
    }
    await this.initializationPromise;
  }

  private async loadConfig(): Promise<void> {
    // First try environment variables
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (clientId && clientSecret) {
      this.config = {
        client_id: clientId,
        client_secret: clientSecret,
        auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_uri: 'https://oauth2.googleapis.com/token'
      };
    } else {
      // Fall back to config file if environment variables are not set
      try {
        const configPath = process.env.GAUTH_FILE || path.resolve('config', 'gauth.json');
        const data = await fs.readFile(configPath, 'utf-8');
        this.config = JSON.parse(data) as OAuthConfig;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new GoogleApiError(
            'OAuth credentials not found',
            'CONFIG_NOT_FOUND',
            'Please provide GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables or ensure config/gauth.json exists'
          );
        }
        throw new GoogleApiError(
          'Failed to load OAuth configuration',
          'OAUTH_CONFIG_ERROR',
          'Please check your environment variables or ensure gauth.json is valid'
        );
      }
    }

    if (!this.config) {
      throw new GoogleApiError(
        'OAuth configuration not available',
        'CONFIG_NOT_FOUND',
        'Please provide OAuth credentials through environment variables or config file'
      );
    }

    this.client = new google.auth.OAuth2(
      this.config.client_id,
      this.config.client_secret,
      'urn:ietf:wg:oauth:2.0:oob'  // Use device code flow
    );
  }

  async generateAuthUrl(scopes: string[]): Promise<string> {
    await this.ensureInitialized();
    if (!this.config || !this.client) {
      throw new GoogleApiError(
        'OAuth client not initialized',
        'CLIENT_NOT_INITIALIZED',
        'Please ensure the OAuth configuration is loaded'
      );
    }

    return this.client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'  // Force consent screen to ensure we get refresh token
    });
  }

  async getTokenFromCode(code: string): Promise<TokenData> {
    await this.ensureInitialized();
    if (!this.client) {
      throw new GoogleApiError(
        'OAuth client not initialized',
        'CLIENT_NOT_INITIALIZED',
        'Please ensure the OAuth configuration is loaded'
      );
    }

    try {
      const { tokens } = await this.client.getToken(code);
      
      if (!tokens.refresh_token) {
        throw new GoogleApiError(
          'No refresh token received',
          'NO_REFRESH_TOKEN',
          'Please ensure you have included offline access in your scopes'
        );
      }

      return {
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope!,
        token_type: tokens.token_type!,
        expiry_date: tokens.expiry_date!,
        last_refresh: Date.now()
      };
    } catch (error) {
      if (error instanceof GoogleApiError) {
        throw error;
      }
      throw new GoogleApiError(
        'Failed to get token from code',
        'TOKEN_EXCHANGE_ERROR',
        'The authorization code may be invalid or expired'
      );
    }
  }

  async refreshToken(refreshToken: string): Promise<TokenData> {
    await this.ensureInitialized();
    if (!this.client) {
      throw new GoogleApiError(
        'OAuth client not initialized',
        'CLIENT_NOT_INITIALIZED',
        'Please ensure the OAuth configuration is loaded'
      );
    }

    try {
      this.client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await this.client.refreshAccessToken();
      
      return {
        access_token: credentials.access_token!,
        refresh_token: refreshToken, // Keep existing refresh token
        scope: credentials.scope!,
        token_type: credentials.token_type!,
        expiry_date: credentials.expiry_date!,
        last_refresh: Date.now()
      };
    } catch (error) {
      throw new GoogleApiError(
        'Failed to refresh token',
        'TOKEN_REFRESH_ERROR',
        'The refresh token may be invalid or revoked'
      );
    }
  }

  async validateToken(token: TokenData): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.client) {
      throw new GoogleApiError(
        'OAuth client not initialized',
        'CLIENT_NOT_INITIALIZED',
        'Please ensure the OAuth configuration is loaded'
      );
    }

    try {
      this.client.setCredentials({
        access_token: token.access_token,
        refresh_token: token.refresh_token
      });

      await this.client.getTokenInfo(token.access_token);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getAuthClient(): Promise<OAuth2Client> {
    await this.ensureInitialized();
    if (!this.client) {
      throw new GoogleApiError(
        'OAuth client not initialized',
        'CLIENT_NOT_INITIALIZED',
        'Please ensure the OAuth configuration is loaded'
      );
    }
    return this.client;
  }
}
