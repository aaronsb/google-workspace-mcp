import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { exec } from 'child_process';
import { OAuthConfig, TokenData, GoogleApiError } from '../types.js';

const CALLBACK_PORT = 3333;
const CALLBACK_PATH = '/oauth2callback';

export class GoogleOAuthClient {
  private client!: OAuth2Client;
  private config!: OAuthConfig;
  private callbackServer?: http.Server;

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
    return new Promise((resolve, reject) => {
      this.callbackServer = http.createServer(async (req, res) => {
        try {
          if (!req.url) throw new Error('No URL in request');

          const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
          if (url.pathname !== CALLBACK_PATH) return;

          const code = url.searchParams.get('code');
          if (!code) throw new Error('No authorization code received');

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authentication successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <script>window.close()</script>
              </body>
            </html>
          `);

          this.callbackServer?.close();
          resolve(code);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.error('Callback error:', err.message);
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Authentication failed');
          reject(err);
        }
      });

      this.callbackServer.listen(CALLBACK_PORT, () => {
        console.log(`Callback server listening on port ${CALLBACK_PORT}`);
      });

      this.callbackServer.on('error', (error: Error) => {
        console.error('Server error:', error.message);
        reject(error);
      });
    });
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
    const redirect_uri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
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
    return this.client;
  }
}
