import { scopeRegistry } from '../tools/scope-registry.js';

// Define Calendar scopes as constants for reuse and testing
export const CALENDAR_SCOPES = {
  READONLY: 'https://www.googleapis.com/auth/calendar.readonly',
  EVENTS: 'https://www.googleapis.com/auth/calendar.events',
  SETTINGS_READONLY: 'https://www.googleapis.com/auth/calendar.settings.readonly',
  FULL_ACCESS: 'https://www.googleapis.com/auth/calendar'
};

/**
 * Register Calendar OAuth scopes at startup.
 * Auth issues will be handled via 401 responses rather than pre-validation.
 * 
 * IMPORTANT: The order of scope registration matters for auth URL generation.
 * Core functionality scopes (readonly) should be registered first,
 * followed by feature-specific scopes (events), and settings scopes last.
 */
export function registerCalendarScopes() {
  // Register core functionality scopes first
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.READONLY);
  
  // Register feature-specific scopes
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.EVENTS);
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.FULL_ACCESS);
  
  // Register settings scopes last
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.SETTINGS_READONLY);
  
  // Verify all scopes are registered
  const registeredScopes = scopeRegistry.getAllScopes();
  const requiredScopes = Object.values(CALENDAR_SCOPES);
  
  const missingScopes = requiredScopes.filter(scope => !registeredScopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Failed to register Calendar scopes: ${missingScopes.join(', ')}`);
  }
}
