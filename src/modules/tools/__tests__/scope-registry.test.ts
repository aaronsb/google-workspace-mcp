import { scopeRegistry } from '../scope-registry.js';

describe('ScopeRegistry', () => {
  beforeEach(() => {
    // Reset the scope registry before each test
    // @ts-expect-error - accessing private property for testing
    scopeRegistry.scopes = new Map();
    // @ts-expect-error - accessing private property for testing
    scopeRegistry.scopeOrder = [];
  });

  it('should maintain scope registration order', () => {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels'
    ];

    // Register scopes
    scopes.forEach(scope => {
      scopeRegistry.registerScope('gmail', scope);
    });

    // Verify order matches registration order
    expect(scopeRegistry.getAllScopes()).toEqual(scopes);
  });

  it('should update scope position when re-registered', () => {
    const scope1 = 'https://www.googleapis.com/auth/gmail.readonly';
    const scope2 = 'https://www.googleapis.com/auth/gmail.send';
    const scope3 = 'https://www.googleapis.com/auth/gmail.labels';

    // Register initial scopes
    scopeRegistry.registerScope('gmail', scope1);
    scopeRegistry.registerScope('gmail', scope2);
    scopeRegistry.registerScope('gmail', scope3);

    // Re-register scope1 (should move to end)
    scopeRegistry.registerScope('gmail', scope1);

    // Verify new order
    expect(scopeRegistry.getAllScopes()).toEqual([
      scope2,
      scope3,
      scope1
    ]);
  });

  it('should maintain tool associations when re-registering scopes', () => {
    const scope = 'https://www.googleapis.com/auth/gmail.labels';
    
    // Register with first tool
    scopeRegistry.registerScope('tool1', scope);
    
    // Re-register with second tool
    scopeRegistry.registerScope('tool2', scope);
    
    // Get scopes for both tools
    const tool1Scopes = scopeRegistry.getToolScopes('tool1');
    const tool2Scopes = scopeRegistry.getToolScopes('tool2');
    
    // Verify scope is associated with latest tool only
    expect(tool1Scopes).not.toContain(scope);
    expect(tool2Scopes).toContain(scope);
  });

  it('should return empty array for non-existent tool', () => {
    const scopes = scopeRegistry.getToolScopes('non-existent-tool');
    expect(scopes).toEqual([]);
  });

  it('should handle multiple scopes for same tool', () => {
    const tool = 'gmail';
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.labels'
    ];

    scopes.forEach(scope => {
      scopeRegistry.registerScope(tool, scope);
    });

    const toolScopes = scopeRegistry.getToolScopes(tool);
    expect(toolScopes).toEqual(scopes);
  });
});
