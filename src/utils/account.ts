import fs from 'fs/promises';
import path from 'path';
import { Account, AccountsConfig, GoogleApiError } from '../types.js';

export class AccountManager {
  private readonly accountsPath: string;
  private accounts: Map<string, Account>;

  constructor() {
    this.accountsPath = path.resolve('config', 'accounts.json');
    this.accounts = new Map();
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
      throw new GoogleApiError(
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
      throw new GoogleApiError(
        'Failed to save accounts configuration',
        'ACCOUNTS_SAVE_ERROR',
        'Please ensure accounts.json is writable'
      );
    }
  }

  async addAccount(email: string, category: string, description: string): Promise<Account> {
    if (!this.validateEmail(email)) {
      throw new GoogleApiError(
        'Invalid email format',
        'INVALID_EMAIL',
        'Please provide a valid email address'
      );
    }

    if (this.accounts.has(email)) {
      throw new GoogleApiError(
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
      throw new GoogleApiError(
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
      throw new GoogleApiError(
        'Account not found',
        'ACCOUNT_NOT_FOUND',
        'Cannot remove non-existent account'
      );
    }

    this.accounts.delete(email);
    await this.saveAccounts();
  }

  async getAccount(email: string): Promise<Account | null> {
    return this.accounts.get(email) || null;
  }

  async validateAccount(
    email: string,
    category?: string,
    description?: string
  ): Promise<Account> {
    let account = await this.getAccount(email);

    if (!account && category && description) {
      account = await this.addAccount(email, category, description);
    } else if (!account) {
      throw new GoogleApiError(
        'Account not found',
        'ACCOUNT_NOT_FOUND',
        'Please provide category and description for new accounts'
      );
    }

    return account;
  }
}
