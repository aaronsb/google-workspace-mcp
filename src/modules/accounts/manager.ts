import fs from 'fs/promises';
import path from 'path';
import { Account, AccountsConfig, AccountError, AccountModuleConfig } from './types.js';
import { ALL_SCOPES } from '../../common/scopes.js';
import { TokenManager } from './token.js';
import { GoogleOAuthClient } from './oauth.js';

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
    await this.oauthClient.ensureInitialized();
    await this.loadAccounts();
  }

  async listAccounts(): Promise<Account[]> {
    await this.loadAccounts();
    const accounts = Array.from(this.accounts.values());
    
    // Add auth status to each account
    for (const account of accounts) {
      account.auth_status = await this.tokenManager.getTokenStatus(account.email);
    }
    
    return accounts;
  }

  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async loadAccounts(): Promise<void> {
    try {
      const data = await fs.readFile(this.accountsPath, 'utf-8');
      const config = JSON.parse(data) as AccountsConfig;
      
      this.accounts.clear();
      for (const account of config.accounts) {
        this.accounts.set(account.email, account);
      }
    } catch (error) {
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
    if (!this.validateEmail(email)) {
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
    if (!this.accounts.has(email)) {
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
  }

  async getAccount(email: string): Promise<Account | null> {
    return this.accounts.get(email) || null;
  }

  async validateAccount(
    email: string,
    category?: string,
    description?: string,
    requiredScopes: string[] = ALL_SCOPES
  ): Promise<Account> {
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

    // If scopes are provided, validate token and include auth status
    if (requiredScopes) {
      const tokenStatus = await this.tokenManager.validateToken(email, requiredScopes);
      account.auth_status = {
        valid: tokenStatus.valid,
        reason: tokenStatus.reason,
        authUrl: tokenStatus.authUrl,
        requiredScopes: tokenStatus.requiredScopes
      };
    }

    return account;
  }

  // OAuth related methods
  async generateAuthUrl(scopes: string[]): Promise<string> {
    return this.oauthClient.generateAuthUrl(scopes);
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
  async validateToken(email: string, requiredScopes: string[]) {
    return this.tokenManager.validateToken(email, requiredScopes);
  }

  async saveToken(email: string, tokenData: any) {
    return this.tokenManager.saveToken(email, tokenData);
  }
}
