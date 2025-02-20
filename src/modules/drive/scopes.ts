import { scopeRegistry } from '../tools/scope-registry.js';

// Define Drive scopes as constants for reuse and testing
// Reference: https://developers.google.com/drive/api/auth/scopes
export const DRIVE_SCOPES = {
  // Full access to files and folders (create, read, update, delete)
  FULL: 'https://www.googleapis.com/auth/drive',
  
  // Read-only access to files
  READONLY: 'https://www.googleapis.com/auth/drive.readonly',
  
  // Access to files created by the app
  FILE: 'https://www.googleapis.com/auth/drive.file',
  
  // Access to metadata only
  METADATA: 'https://www.googleapis.com/auth/drive.metadata',
  
  // Access to app data folder
  APPDATA: 'https://www.googleapis.com/auth/drive.appdata',
} as const;

export type DriveScope = typeof DRIVE_SCOPES[keyof typeof DRIVE_SCOPES];

/**
 * Register Drive OAuth scopes at startup.
 * Auth issues will be handled via 401 responses rather than pre-validation.
 * 
 * IMPORTANT: The order of scope registration matters for auth URL generation.
 * Core functionality scopes should be registered first,
 * followed by feature-specific scopes.
 */
export function registerDriveScopes(): void {
  // Register core functionality scopes first
  scopeRegistry.registerScope('drive', DRIVE_SCOPES.FULL);
  scopeRegistry.registerScope('drive', DRIVE_SCOPES.READONLY);
  scopeRegistry.registerScope('drive', DRIVE_SCOPES.FILE);
  
  // Register feature-specific scopes
  scopeRegistry.registerScope('drive', DRIVE_SCOPES.METADATA);
  scopeRegistry.registerScope('drive', DRIVE_SCOPES.APPDATA);
  
  // Verify all scopes are registered
  const registeredScopes = scopeRegistry.getAllScopes();
  const requiredScopes = Object.values(DRIVE_SCOPES);
  
  const missingScopes = requiredScopes.filter(scope => !registeredScopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Failed to register Drive scopes: ${missingScopes.join(', ')}`);
  }
}

export function getDriveScopes(): string[] {
  return Object.values(DRIVE_SCOPES);
}

export function validateDriveScopes(scopes: string[]): boolean {
  const validScopes = new Set(getDriveScopes());
  return scopes.every(scope => validScopes.has(scope));
}
