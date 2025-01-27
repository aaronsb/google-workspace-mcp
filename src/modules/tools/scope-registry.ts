import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * The ScopeRegistry is a critical component that manages OAuth scopes across the application.
 * It addresses permission scope issues for both Gmail and Calendar services by:
 * 
 * 1. Centralizing scope registration: All tools must register their required scopes
 * 2. Enforcing scope validation: Ensures tokens have all necessary permissions
 * 3. Preventing scope conflicts: Warns about scope overlaps between tools
 * 4. Tracking scope requirements: Maps scopes to the tools that require them
 * 
 * Gmail-specific benefits:
 * - Prevents "Metadata scope does not support 'q' parameter" error
 * - Ensures full read access for email content
 * - Maintains proper permissions for email operations
 * 
 * Calendar-specific benefits:
 * - Ensures proper access for event management
 * - Maintains consistent permissions for calendar operations
 * - Prevents partial access issues for calendar features
 */

export interface ToolScope {
  scope: string;
  description: string;
  tool: string;
}

/**
 * Manages OAuth scope registration, validation, and tracking across Gmail and Calendar services.
 * 
 * Key features:
 * - Singleton pattern ensures consistent scope management
 * - Validates token scopes against registered requirements
 * - Prevents metadata-only permission issues in Gmail
 * - Ensures proper Calendar access levels
 * - Provides scope information for authentication flows
 */
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
   * Registers a scope requirement for a tool.
   * 
   * @param tool - Name of the tool requiring the scope (e.g., 'gmail' or 'calendar')
   * @param scope - OAuth scope string
   * @param description - Human-readable description of why the scope is needed
   * 
   * Examples:
   * ```typescript
   * // Gmail scope registration
   * scopeRegistry.registerScope(
   *   'gmail',
   *   'https://www.googleapis.com/auth/gmail.readonly',
   *   'Required for reading email content, not just metadata'
   * );
   * 
   * // Calendar scope registration
   * scopeRegistry.registerScope(
   *   'calendar',
   *   'https://www.googleapis.com/auth/calendar.events',
   *   'Required for managing calendar events'
   * );
   * ```
   */
  registerScope(tool: string, scope: string, description: string) {
    if (this.scopes.has(scope)) {
      const existing = this.scopes.get(scope)!;
      if (existing.tool !== tool) {
        console.warn(`Scope ${scope} already registered by ${existing.tool}, now also requested by ${tool}`);
      }
      return;
    }

    this.scopes.set(scope, { scope, description, tool });
  }

  getAllScopes(): string[] {
    return Array.from(this.scopes.keys());
  }

  getToolScopes(tool: string): string[] {
    return Array.from(this.scopes.values())
      .filter(scope => scope.tool === tool)
      .map(scope => scope.scope);
  }

  /**
   * Validates that all required scopes are present in the granted scopes.
   * This is crucial for preventing permission issues across services by ensuring
   * proper access scopes are granted.
   * 
   * Common validations:
   * - Gmail: Ensures full access vs metadata-only permissions
   * - Calendar: Validates event management permissions
   * 
   * @param grantedScopes - Array of scopes from the OAuth token
   * @throws {McpError} If any required scopes are missing
   * 
   * Example errors:
   * "Missing required scopes:
   * https://www.googleapis.com/auth/gmail.readonly (required by gmail: Read email content)
   * https://www.googleapis.com/auth/calendar.events (required by calendar: Manage events)"
   */
  validateScopes(grantedScopes: string[]): void {
    const requiredScopes = this.getAllScopes();
    const missingScopes = requiredScopes.filter(scope => !grantedScopes.includes(scope));

    if (missingScopes.length > 0) {
      const scopeDetails = missingScopes.map(scope => {
        const details = this.scopes.get(scope)!;
        return `${scope} (required by ${details.tool}: ${details.description})`;
      });

      throw new McpError(
        ErrorCode.InvalidRequest,
        `Missing required scopes:\n${scopeDetails.join('\n')}`
      );
    }
  }

  getScopeDetails(): ToolScope[] {
    return Array.from(this.scopes.values());
  }
}

// Export a singleton instance
export const scopeRegistry = ScopeRegistry.getInstance();
