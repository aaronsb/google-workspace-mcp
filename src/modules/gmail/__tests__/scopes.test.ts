import { registerGmailScopes, GMAIL_SCOPES } from '../scopes.js';
import { scopeRegistry } from '../../tools/scope-registry.js';

describe('Gmail Scopes', () => {
  beforeEach(() => {
    // Reset the scope registry before each test
    // @ts-expect-error - accessing private property for testing
    scopeRegistry.scopes = new Map();
    // @ts-expect-error - accessing private property for testing
    scopeRegistry.scopeOrder = [];
  });

  it('should register all required Gmail scopes', () => {
    registerGmailScopes();
    const registeredScopes = scopeRegistry.getAllScopes();
    
    // Required scopes for Gmail functionality
    const requiredScopes = [
      GMAIL_SCOPES.READONLY,  // For reading emails and labels
      GMAIL_SCOPES.SEND,      // For sending emails
      GMAIL_SCOPES.MODIFY,    // For modifying emails and drafts
      GMAIL_SCOPES.LABELS,    // For label management
      GMAIL_SCOPES.SETTINGS_BASIC,    // For Gmail settings
      GMAIL_SCOPES.SETTINGS_SHARING   // For settings management
    ];

    // Verify each required scope is registered
    requiredScopes.forEach(scope => {
      expect(registeredScopes).toContain(scope);
    });
  });

  it('should register scopes in correct order', () => {
    registerGmailScopes();
    const registeredScopes = scopeRegistry.getAllScopes();

    // Core functionality scopes should come first
    const coreScopes = [
      GMAIL_SCOPES.READONLY,
      GMAIL_SCOPES.SEND,
      GMAIL_SCOPES.MODIFY
    ];

    // Feature-specific scopes should come next
    const featureScopes = [
      GMAIL_SCOPES.LABELS
    ];

    // Settings scopes should come last
    const settingsScopes = [
      GMAIL_SCOPES.SETTINGS_BASIC,
      GMAIL_SCOPES.SETTINGS_SHARING
    ];

    // Verify order of scope groups
    const firstCoreIndex = Math.min(...coreScopes.map(scope => registeredScopes.indexOf(scope)));
    const firstFeatureIndex = Math.min(...featureScopes.map(scope => registeredScopes.indexOf(scope)));
    const firstSettingsIndex = Math.min(...settingsScopes.map(scope => registeredScopes.indexOf(scope)));

    expect(firstCoreIndex).toBeLessThan(firstFeatureIndex);
    expect(firstFeatureIndex).toBeLessThan(firstSettingsIndex);
  });

  it('should maintain scope registration when re-registering', () => {
    // Register scopes first time
    registerGmailScopes();
    const initialScopes = scopeRegistry.getAllScopes();

    // Register scopes second time
    registerGmailScopes();
    const finalScopes = scopeRegistry.getAllScopes();

    // Verify all scopes are still registered in same order
    expect(finalScopes).toEqual(initialScopes);
  });
});
