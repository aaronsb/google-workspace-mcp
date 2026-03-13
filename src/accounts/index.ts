export { authenticateAccount } from './auth.js';
export type { AuthResult } from './auth.js';
export { hasCredential, readCredential, removeCredential, listCredentials, exportAndSaveCredential } from './credentials.js';
export type { AuthorizedUserCredential } from './credentials.js';
export { listAccounts, getAccount, addAccount, removeAccount, authenticateAndAddAccount } from './registry.js';
export type { Account } from './registry.js';
