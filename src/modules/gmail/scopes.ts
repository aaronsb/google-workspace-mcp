import { scopeRegistry } from '../tools/scope-registry.js';

/**
 * Register Gmail OAuth scopes at startup.
 * Auth issues will be handled via 401 responses rather than pre-validation.
 */
export function registerGmailScopes() {
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.readonly'
  );

  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.send'
  );

  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.modify'
  );

  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.labels'
  );

  // Add settings scopes for Gmail settings functionality
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.settings.basic'
  );

  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.settings.sharing'
  );
}
