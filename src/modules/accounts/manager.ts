import fs from 'fs/promises';
import path from 'path';
import { Account, AccountsConfig, AccountError, AccountModuleConfig } from './types.js';
import { scopeRegistry } from '../tools/scope-registry.js';
import { TokenManager } from './token.js';
import { GoogleOAuthClient } from './oauth.js';
import logger from '../../utils/logger.js';

export class AccountManager {
  private readonly accountsPath: string;
  private accounts: Map<string, Account>;
  private tokenManager!: TokenManager;
  private oauthClient!: GoogleOAuthClient;

  constructor(config?: AccountModuleConfig) {
    this.accountsPath = config?.accountsPath || path.resolve('/app/config/accounts.json');
    this.accounts = new Map();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing AccountManager...');
    this.oauthClient = new GoogleOAuthClient();
    this.tokenManager = new TokenManager(this.oauthClient);
    await this.loadAccounts();
    logger.info('AccountManager initialized successfully');
  }

  async listAccounts(): Promise<Account[]> {
    logger.debug('Listing accounts with auth status');
    const accounts = Array.from(this.accounts.values());
    
    // Add auth status to each account and attempt auto-renewal if needed
    for (const account of accounts) {
      const renewalResult = await this.tokenManager.autoRenewToken(account.email);
      
      if (renewalResult.success) {
        account.auth_status = {
          valid: true,
          status: renewalResult.status
        };
      } else {
        // If auto-renewal failed, try to get an auth URL for re-authentication
        account.auth_status = {
          valid: false,
          status: renewalResult.status,
          reason: renewalResult.reason,
          authUrl: await this.generateAuthUrl()
        };
      }
    }
    
    logger.debug(`Found ${accounts.length} accounts`);
    return accounts;
  }

  /**
   * Wrapper for tool operations that handles token renewal
   * @param email Account email
   * @param operation Function that performs the actual operation
   */
  async withTokenRenewal<T>(
    email: string,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      // Attempt auto-renewal before operation
      const renewalResult = await this.tokenManager.autoRenewToken(email);
      if (!renewalResult.success) {
        if (renewalResult.canRetry) {
          // If it's a temporary error, let the operation proceed
          // The 401 handler below will catch and retry if needed
          logger.warn('Token renewal failed but may be temporary - proceeding with operation');
        } else {
          // Only require re-auth if refresh token is invalid/revoked
          throw new AccountError(
            'Token renewal failed',
            'TOKEN_RENEWAL_FAILED',
            renewalResult.reason || 'Please re-authenticate your account'
          );
        }
      }

      // Perform the operation
      return await operation();
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '401') {
        // If we get a 401 during operation, try one more token renewal
        logger.warn('Received 401 during operation, attempting final token renewal');
        const finalRenewal = await this.tokenManager.autoRenewToken(email);
        
        if (finalRenewal.success) {
          // Retry the operation with renewed token
          return await operation();
        }
        
        // Check if we should trigger full OAuth
        if (!finalRenewal.canRetry) {
          // Refresh token is invalid/revoked, need full reauth
          throw new AccountError(
            'Authentication failed',
            'AUTH_REQUIRED',
            finalRenewal.reason || 'Please re-authenticate your account'
          );
        } else {
          // Temporary error, let caller handle retry
          throw new AccountError(
            'Token refresh failed temporarily',
            'TEMPORARY_AUTH_ERROR',
            'Please try again later'
          );
        }
      }
      throw error;
    }
  }

  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async loadAccounts(): Promise<void> {
    try {
      logger.debug(`Loading accounts from ${this.accountsPath}`);
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.accountsPath), { recursive: true });
      
      let data: string;
      try {
        data = await fs.readFile(this.accountsPath, 'utf-8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          // Create empty accounts file if it doesn't exist
          logger.info('Creating new accounts file');
          data = JSON.stringify({ accounts: [] });
          await fs.writeFile(this.accountsPath, data);
        } else {
          throw new AccountError(
            'Failed to read accounts configuration',
            'ACCOUNTS_READ_ERROR',
            'Please ensure the accounts file is readable'
          );
        }
      }

      try {
        const config = JSON.parse(data) as AccountsConfig;
        this.accounts.clear();
        for (const account of config.accounts) {
          this.accounts.set(account.email, account);
        }
      } catch (error) {
        throw new AccountError(
          'Failed to parse accounts configuration',
          'ACCOUNTS_PARSE_ERROR',
          'Please ensure the accounts file contains valid JSON'
        );
      }
    } catch (error) {
      if (error instanceof AccountError) {
        throw error;
      }
      throw new AccountError(
        'Failed to load accounts configuration',
        'ACCOUNTS_LOAD_ERROR',
        'Please ensure accounts.json exists and is valid'
      );
    }
  }

  private async saveAccounts(): Promise<void> {
    try {
      const config: AccountsConfig = {
        accounts: Array.from(this.accounts.values())
      };
      await fs.writeFile(
        this.accountsPath,
        JSON.stringify(config, null, 2)
      );
    } catch (error) {
      throw new AccountError(
        'Failed to save accounts configuration',
        'ACCOUNTS_SAVE_ERROR',
        'Please ensure accounts.json is writable'
      );
    }
  }

  async addAccount(email: string, category: string, description: string): Promise<Account> {
    logger.info(`Adding new account: ${email}`);
    if (!this.validateEmail(email)) {
      logger.error(`Invalid email format: ${email}`);
      throw new AccountError(
        'Invalid email format',
        'INVALID_EMAIL',
        'Please provide a valid email address'
      );
    }

    if (this.accounts.has(email)) {
      throw new AccountError(
        'Account already exists',
        'DUPLICATE_ACCOUNT',
        'Use updateAccount to modify existing accounts'
      );
    }

    const account: Account = {
      email,
      category,
      description
    };

    this.accounts.set(email, account);
    await this.saveAccounts();
    return account;
  }

  async updateAccount(email: string, updates: Partial<Omit<Account, 'email'>>): Promise<Account> {
    const account = this.accounts.get(email);
    if (!account) {
      throw new AccountError(
        'Account not found',
        'ACCOUNT_NOT_FOUND',
        'Please ensure the account exists before updating'
      );
    }

    const updatedAccount: Account = {
      ...account,
      ...updates
    };

    this.accounts.set(email, updatedAccount);
    await this.saveAccounts();
    return updatedAccount;
  }

  async removeAccount(email: string): Promise<void> {
    logger.info(`Removing account: ${email}`);
    if (!this.accounts.has(email)) {
      logger.error(`Account not found: ${email}`);
      throw new AccountError(
        'Account not found',
        'ACCOUNT_NOT_FOUND',
        'Cannot remove non-existent account'
      );
    }

    // Delete token first
    await this.tokenManager.deleteToken(email);
    
    // Then remove account
    this.accounts.delete(email);
    await this.saveAccounts();
    logger.info(`Successfully removed account: ${email}`);
  }

  async getAccount(email: string): Promise<Account | null> {
    return this.accounts.get(email) || null;
  }

  async validateAccount(
    email: string,
    category?: string,
    description?: string
  ): Promise<Account> {
    logger.debug(`Validating account: ${email}`);
    let account = await this.getAccount(email);
    const isNewAccount: boolean = Boolean(!account && category && description);

    try {
      // Handle new account creation
      if (isNewAccount && category && description) {
        logger.info('Creating new account during validation');
        account = await this.addAccount(email, category, description);
      } else if (!account) {
        throw new AccountError(
          'Account not found',
          'ACCOUNT_NOT_FOUND',
          'Please provide category and description for new accounts'
        );
      }

      // Validate token with appropriate flags for new accounts
      const tokenStatus = await this.tokenManager.validateToken(email, isNewAccount);
      
      // Map token status to account auth status
      switch (tokenStatus.status) {
        case 'NO_TOKEN':
          account.auth_status = {
            valid: false,
            status: tokenStatus.status,
            reason: isNewAccount ? 'New account requires authentication' : 'No token found',
            authUrl: await this.generateAuthUrl()
          };
          break;
          
        case 'VALID':
        case 'REFRESHED':
          account.auth_status = {
            valid: true,
            status: tokenStatus.status
          };
          break;
          
        case 'INVALID':
        case 'REFRESH_FAILED':
        case 'EXPIRED':
          account.auth_status = {
            valid: false,
            status: tokenStatus.status,
            reason: tokenStatus.reason,
            authUrl: await this.generateAuthUrl()
          };
          break;
          
        case 'ERROR':
          account.auth_status = {
            valid: false,
            status: tokenStatus.status,
            reason: 'Authentication error occurred',
            authUrl: await this.generateAuthUrl()
          };
          break;
      }

      logger.debug(`Account validation complete for ${email}. Status: ${tokenStatus.status}`);
      return account;
      
    } catch (error) {
      logger.error('Account validation failed', error as Error);
      if (error instanceof AccountError) {
        throw error;
      }
      throw new AccountError(
        'Account validation failed',
        'VALIDATION_ERROR',
        'An unexpected error occurred during account validation'
      );
    }
  }

  // OAuth related methods
  async generateAuthUrl(): Promise<string> {
    const allScopes = scopeRegistry.getAllScopes();
    return this.oauthClient.generateAuthUrl(allScopes);
  }

  async waitForAuthorizationCode(): Promise<string> {
    return this.oauthClient.waitForAuthorizationCode();
  }

  async getTokenFromCode(code: string): Promise<any> {
    const token = await this.oauthClient.getTokenFromCode(code);
    return token;
  }

  async refreshToken(refreshToken: string): Promise<any> {
    return this.oauthClient.refreshToken(refreshToken);
  }

  async getAuthClient() {
    return this.oauthClient.getAuthClient();
  }

  // Token related methods
  async validateToken(email: string, skipValidationForNew: boolean = false) {
    return this.tokenManager.validateToken(email, skipValidationForNew);
  }

  async saveToken(email: string, tokenData: any) {
    return this.tokenManager.saveToken(email, tokenData);
  }
}
