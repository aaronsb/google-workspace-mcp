import { scopeRegistry } from '../tools/scope-registry.js';

/**
 * Registers Gmail OAuth scopes with the scope registry.
 * 
 * IMPORTANT: The full set of scopes is required to prevent the "Metadata scope" errors.
 * Previously, using only metadata scope led to two specific issues:
 * 1. "Metadata scope does not support 'q' parameter" - Search functionality was limited
 * 2. "Metadata scope doesn't allow format FULL" - Could not fetch complete email content
 * 
 * The solution is to ensure proper registration of full access scopes:
 * - gmail.readonly: Required for search and full email content
 * - gmail.modify: Needed for email modifications and label management
 * - gmail.send: Required for sending emails
 * 
 * The metadata scope alone is insufficient for most operations and should be
 * combined with fuller access scopes for proper functionality.
 */
export function registerGmailScopes() {
  // Core access scope - Required for full email content and search
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.readonly',
    'Required for reading full email content and performing searches'
  );

  // Modification scope - Required for managing emails and labels
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.modify',
    'Required for modifying emails and managing labels'
  );

  // Send scope - Required for email composition
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.send',
    'Required for sending emails'
  );

  // Metadata scope - Supplementary to full access scopes
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.metadata',
    'Supplementary scope for basic metadata access (headers/labels). Note: Must be combined with fuller access scopes.'
  );

  // Settings scopes - Required for account configuration
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'Required for managing basic Gmail settings'
  );

  // Sharing scope - Required for delegation and sharing features
  scopeRegistry.registerScope(
    'gmail',
    'https://www.googleapis.com/auth/gmail.settings.sharing',
    'Required for managing Gmail delegation and sharing settings'
  );
}
