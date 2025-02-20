/**
 * Simple registry to collect OAuth scopes needed by tools.
 * Scopes are gathered at startup and used for initial auth only.
 * No validation is performed - auth issues are handled via 401 responses.
 */

export interface ToolScope {
  scope: string;
  tool: string;
}

export class ScopeRegistry {
  private static instance: ScopeRegistry;
  private scopes: Map<string, ToolScope>;
  private scopeOrder: string[]; // Maintain registration order

  private constructor() {
    this.scopes = new Map();
    this.scopeOrder = [];
  }

  static getInstance(): ScopeRegistry {
    if (!ScopeRegistry.instance) {
      ScopeRegistry.instance = new ScopeRegistry();
    }
    return ScopeRegistry.instance;
  }

  /**
   * Register a scope needed by a tool.
   * If the scope is already registered, it will not be re-registered
   * but its position in the order will be updated.
   */
  registerScope(tool: string, scope: string) {
    // Remove from order if already exists
    const existingIndex = this.scopeOrder.indexOf(scope);
    if (existingIndex !== -1) {
      this.scopeOrder.splice(existingIndex, 1);
    }

    // Add to map and order
    this.scopes.set(scope, { scope, tool });
    this.scopeOrder.push(scope);
  }

  /**
   * Get all registered scopes in their registration order.
   * This order is important for auth URL generation to ensure
   * consistent scope presentation to users.
   */
  getAllScopes(): string[] {
    // Return scopes in registration order
    return this.scopeOrder;
  }

  getToolScopes(tool: string): string[] {
    return Array.from(this.scopes.values())
      .filter(scope => scope.tool === tool)
      .map(scope => scope.scope);
  }

}

// Export a singleton instance
export const scopeRegistry = ScopeRegistry.getInstance();
