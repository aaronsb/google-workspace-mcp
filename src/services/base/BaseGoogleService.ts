import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAccountManager } from '../../modules/accounts/index.js';

/**
 * Base error class for Google services
 */
export class GoogleServiceError extends McpError {
  constructor(
    message: string,
    code: string,
    details?: string
  ) {
    super(ErrorCode.InternalError, message, { code, details });
  }
}

/**
 * Configuration interface for Google services
 */
export interface GoogleServiceConfig {
  serviceName: string;
  version: string;
}

/**
 * Base class for Google service implementations.
 * Provides common functionality for authentication, error handling, and client management.
 */
export abstract class BaseGoogleService<TClient> {
  protected oauth2Client?: OAuth2Client;
  private apiClients: Map<string, TClient> = new Map();
  private readonly serviceName: string;

  constructor(config: GoogleServiceConfig) {
    this.serviceName = config.serviceName;
  }

  /**
   * Initializes the service by setting up OAuth2 client
   */
  protected async initialize(): Promise<void> {
    try {
      const accountManager = getAccountManager();
      this.oauth2Client = await accountManager.getAuthClient();
    } catch (error) {
      throw this.handleError(error, 'Failed to initialize service');
    }
  }

  /**
   * Gets an authenticated API client for the service
   * 
   * @param email - The email address to get a client for
   * @param clientFactory - Function to create the specific Google API client
   * @returns The authenticated API client
   */
  protected async getAuthenticatedClient(
    email: string,
    clientFactory: (auth: OAuth2Client) => TClient
  ): Promise<TClient> {
    if (!this.oauth2Client) {
      throw new GoogleServiceError(
        `${this.serviceName} client not initialized`,
        'CLIENT_ERROR',
        'Please ensure the service is initialized'
      );
    }

    const existingClient = this.apiClients.get(email);
    if (existingClient) {
      return existingClient;
    }

    try {
      const accountManager = getAccountManager();
      const tokenStatus = await accountManager.validateToken(email);

      if (!tokenStatus.valid || !tokenStatus.token) {
        throw new GoogleServiceError(
          `${this.serviceName} authentication required`,
          'AUTH_REQUIRED',
          'Please authenticate the account'
        );
      }

      this.oauth2Client.setCredentials(tokenStatus.token);
      const client = clientFactory(this.oauth2Client);
      this.apiClients.set(email, client);
      return client;
    } catch (error) {
      throw this.handleError(error, 'Failed to get authenticated client');
    }
  }

  /**
   * Common error handler for Google service operations
   */
  protected handleError(error: unknown, context: string): GoogleServiceError {
    if (error instanceof GoogleServiceError) {
      return error;
    }

    return new GoogleServiceError(
      context,
      'SERVICE_ERROR',
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  /**
   * Validates required scopes are present for an operation
   */
  protected async validateScopes(email: string, requiredScopes: string[]): Promise<void> {
    try {
      const accountManager = getAccountManager();
      const tokenInfo = await accountManager.validateToken(email);

      if (!tokenInfo.requiredScopes) {
        throw new GoogleServiceError(
          'No scopes found in token',
          'SCOPE_ERROR',
          'Token does not contain scope information'
        );
      }

      const missingScopes = requiredScopes.filter(
        scope => !tokenInfo.requiredScopes?.includes(scope)
      );

      if (missingScopes.length > 0) {
        throw new GoogleServiceError(
          'Insufficient permissions',
          'SCOPE_ERROR',
          `Missing required scopes: ${missingScopes.join(', ')}`
        );
      }
    } catch (error) {
      throw this.handleError(error, 'Failed to validate scopes');
    }
  }
}
