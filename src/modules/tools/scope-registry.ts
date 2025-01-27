import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

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

  private constructor() {
    this.scopes = new Map();
  }

  static getInstance(): ScopeRegistry {
    if (!ScopeRegistry.instance) {
      ScopeRegistry.instance = new ScopeRegistry();
    }
    return ScopeRegistry.instance;
  }

  /**
   * Register a scope needed by a tool.
   */
  registerScope(tool: string, scope: string) {
    if (!this.scopes.has(scope)) {
      this.scopes.set(scope, { scope, tool });
    }
  }

  getAllScopes(): string[] {
    return Array.from(this.scopes.keys());
  }

  getToolScopes(tool: string): string[] {
    return Array.from(this.scopes.values())
      .filter(scope => scope.tool === tool)
      .map(scope => scope.scope);
  }

}

// Export a singleton instance
export const scopeRegistry = ScopeRegistry.getInstance();
