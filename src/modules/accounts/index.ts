import { AccountManager } from './manager.js';
import { TokenManager } from './token.js';
import { GoogleOAuthClient } from './oauth.js';
import { Account, AccountError, TokenStatus, AccountModuleConfig } from './types.js';

// Create singleton instance
let accountManager: AccountManager | null = null;

export async function initializeAccountModule(config?: AccountModuleConfig): Promise<AccountManager> {
  if (!accountManager) {
    accountManager = new AccountManager(config);
    await accountManager.initialize();
  }
  return accountManager;
}

export function getAccountManager(): AccountManager {
  if (!accountManager) {
    throw new AccountError(
      'Account module not initialized',
      'MODULE_NOT_INITIALIZED',
      'Call initializeAccountModule before using the account manager'
    );
  }
  return accountManager;
}

export {
  AccountManager,
  TokenManager,
  GoogleOAuthClient,
  Account,
  AccountError,
  TokenStatus,
  AccountModuleConfig
};
