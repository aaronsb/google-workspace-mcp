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
  private tokenManager: TokenManager;
  private oauthClient: GoogleOAuthClient;

  constructor(config?: AccountModuleConfig) {
    this.accountsPath = config?.accountsPath || process.env.ACCOUNTS_FILE || path.resolve('config', 'accounts.json');
    this.accounts = new Map();
    this.oauthClient = new GoogleOAuthClient();
    this.tokenManager = new TokenManager(this.oauthClient);
  }

  async initialize(): Promise<void> {
    logger.info('Initializing AccountManager...');
    await this.oauthClient.ensureInitialized();
    await this.loadAccounts();
    logger.info('AccountManager initialized successfully');
  }

  async listAccounts(): Promise<Account[]> {
    logger.debug('Listing accounts with auth status');
    await this.loadAccounts();
    const accounts = Array.from(this.accounts.values());
    
    // Add auth status to each account
    for (const account of accounts) {
      account.auth_status = await this.tokenManager.validateToken(account.email);
    }
    
    logger.debug(`Found ${accounts.length} accounts`);
    return accounts;
  }

  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async loadAccounts(): Promise<void> {
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
        'Please ensure ACCOUNTS_FILE environment variable is set or accounts.json exists and is valid'
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
        'Please ensure the accounts file specified by ACCOUNTS_FILE is writable'
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

    if (!account && category && description) {
      account = await this.addAccount(email, category, description);
    } else if (!account) {
      throw new AccountError(
        'Account not found',
        'ACCOUNT_NOT_FOUND',
        'Please provide category and description for new accounts'
      );
    }

    // Simple token validation - no scope checking
    const tokenStatus = await this.tokenManager.validateToken(email);
    account.auth_status = {
      valid: tokenStatus.valid,
      reason: tokenStatus.reason
    };

    return account;
  }

  // OAuth related methods
  async generateAuthUrl(): Promise<string> {
    const allScopes = scopeRegistry.getAllScopes();
    return this.oauthClient.generateAuthUrl(allScopes);
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
  async validateToken(email: string) {
    return this.tokenManager.validateToken(email);
  }

  async saveToken(email: string, tokenData: any) {
    return this.tokenManager.saveToken(email, tokenData);
  }
}
