import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { exec } from 'child_process';
import { OAuthConfig, TokenData, GoogleApiError } from '../types.js';

export class GoogleOAuthClient {
  private client!: OAuth2Client;
  private config!: OAuthConfig;
  constructor() {
    // Initialize immediately
    this.loadConfig().catch(error => {
      console.error('Failed to load OAuth config:', error);
      process.exit(1);
    });
  }

  private async openBrowser(url: string): Promise<void> {
    const commands = process.platform === 'win32'
      ? [`start "" "${url}"`, `cmd /c start "" "${url}"`, `rundll32 url.dll,FileProtocolHandler "${url}"`, `explorer.exe "${url}"`]
      : process.platform === 'darwin'
        ? [`open "${url}"`]
        : [`xdg-open "${url}"`, `sensible-browser "${url}"`, `x-www-browser "${url}"`];

    for (const command of commands) {
      try {
        await new Promise<void>((resolve, reject) => {
          exec(command, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        return;
      } catch (error) {
        continue;
      }
    }
    
    console.log('\nPlease open this URL manually in your browser:', url);
  }

  private async waitForCallback(): Promise<string> {
    // Return the code that will be provided manually
    return process.env.AUTH_CODE || '';
  }

  private async loadConfig(): Promise<void> {
    try {
      const configPath = path.resolve('config', 'gauth.json');
      const data = await fs.readFile(configPath, 'utf-8');
      this.config = JSON.parse(data) as OAuthConfig;
      
      this.client = new google.auth.OAuth2(
        this.config.client_id,
        this.config.client_secret,
        this.config.redirect_uri
      );
    } catch (error) {
      throw new GoogleApiError(
        'Failed to load OAuth configuration',
        'OAUTH_CONFIG_ERROR',
        'Please ensure gauth.json exists and is valid'
      );
    }
  }

  async generateAuthUrl(scopes: string[]): Promise<string> {
    // Use Google's device code flow redirect
    const redirect_uri = 'urn:ietf:wg:oauth:2.0:oob';
    this.client = new google.auth.OAuth2(
      this.config.client_id,
      this.config.client_secret,
      redirect_uri
    );

    const authUrl = this.client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'  // Force consent screen to ensure we get refresh token
    });

    console.log('\n🔐 Starting Google Authentication');
    console.log('1. Opening your browser to complete authentication...');
    await this.openBrowser(authUrl);
    console.log('2. Waiting for authentication...\n');

    return authUrl;
  }

  async handleAuthFlow(scopes: string[]): Promise<TokenData> {
    await this.generateAuthUrl(scopes);
    const code = await this.waitForCallback();
    return this.getTokenFromCode(code);
  }

  async getTokenFromCode(code: string): Promise<TokenData> {
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

  getAuthClient(): OAuth2Client {
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
