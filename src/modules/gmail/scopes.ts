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
}
