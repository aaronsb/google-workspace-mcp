import { scopeRegistry } from '../tools/scope-registry.js';

/**
 * Registers Calendar OAuth scopes with the scope registry.
 * 
 * Calendar operations require specific scopes based on the level of access needed:
 * - calendar.readonly: For viewing events without modification rights
 * - calendar.events: For full event management (create/update/delete)
 * - calendar.settings.readonly: For accessing calendar settings
 * 
 * Similar to Gmail's scope system, Calendar scopes are validated to ensure
 * proper access levels are maintained for all operations. This prevents
 * permission-related errors during calendar operations.
 */
export function registerCalendarScopes() {
  // Read-only scope - For viewing calendar data
  scopeRegistry.registerScope(
    'calendar',
    'https://www.googleapis.com/auth/calendar.readonly',
    'Required for viewing calendar events and basic settings'
  );

  // Events scope - Required for full event management
  scopeRegistry.registerScope(
    'calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'Required for creating, updating, and deleting calendar events'
  );

  // Settings scope - For accessing calendar configuration
  scopeRegistry.registerScope(
    'calendar',
    'https://www.googleapis.com/auth/calendar.settings.readonly',
    'Required for accessing calendar settings and preferences'
  );
}
