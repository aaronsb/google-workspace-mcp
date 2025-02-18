import { scopeRegistry } from '../tools/scope-registry.js';

// Define Calendar scopes as constants for reuse and testing
// Reference: https://developers.google.com/calendar/api/auth
export const CALENDAR_SCOPES = {
  // Core functionality scopes
  READONLY: 'https://www.googleapis.com/auth/calendar.readonly',  // Required for reading calendars and events
  EVENTS: 'https://www.googleapis.com/auth/calendar.events',      // Required for creating/updating events
  EVENTS_READONLY: 'https://www.googleapis.com/auth/calendar.events.readonly',  // Required for reading events only
  
  // Settings scopes
  SETTINGS_READONLY: 'https://www.googleapis.com/auth/calendar.settings.readonly',  // Required for reading calendar settings
  
  // Full access scope (includes all above permissions)
  FULL_ACCESS: 'https://www.googleapis.com/auth/calendar'         // Complete calendar access
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
  // Register core functionality scopes first (order matters for auth URL generation)
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.READONLY);   // For reading calendars and events
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.EVENTS);     // For managing calendar events
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.EVENTS_READONLY);  // For reading events only
  
  // Register settings scopes
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.SETTINGS_READONLY);  // For reading calendar settings
  
  // Register full access scope last
  scopeRegistry.registerScope('calendar', CALENDAR_SCOPES.FULL_ACCESS);  // Complete calendar access (includes all above)
  
  // Verify all scopes are registered
  const registeredScopes = scopeRegistry.getAllScopes();
  const requiredScopes = Object.values(CALENDAR_SCOPES);
  
  const missingScopes = requiredScopes.filter(scope => !registeredScopes.includes(scope));
  if (missingScopes.length > 0) {
    throw new Error(`Failed to register Calendar scopes: ${missingScopes.join(', ')}`);
  }
}
