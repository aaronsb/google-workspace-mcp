import { OAuth2Client } from 'google-auth-library';
import { AccountError } from './types.js';
import logger from '../../utils/logger.js';

export class GoogleOAuthClient {
  private oauth2Client: OAuth2Client;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new AccountError(
        'Missing OAuth credentials',
        'AUTH_CONFIG_ERROR',
        'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be provided'
      );
    }

    logger.info('Initializing OAuth client...');
    this.oauth2Client = new OAuth2Client(
      clientId,
      clientSecret,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    logger.info('OAuth client initialized successfully');
  }

  getAuthClient(): OAuth2Client {
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
    logger.info('Generating OAuth authorization URL');
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
    logger.debug('Authorization URL generated successfully');
    return url;
  }

  async getTokenFromCode(code: string): Promise<any> {
    logger.info('Exchanging authorization code for tokens');
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      logger.info('Successfully obtained tokens from auth code');
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
    logger.info('Refreshing access token');
    try {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken
      });
      const { credentials } = await this.oauth2Client!.refreshAccessToken();
      logger.info('Successfully refreshed access token');
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
