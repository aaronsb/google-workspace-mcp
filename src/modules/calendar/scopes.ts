import { scopeRegistry } from '../tools/scope-registry.js';

/**
 * Register Calendar OAuth scopes at startup.
 * Auth issues will be handled via 401 responses rather than pre-validation.
 */
export function registerCalendarScopes() {
  scopeRegistry.registerScope(
    'calendar',
    'https://www.googleapis.com/auth/calendar.readonly'
  );

  scopeRegistry.registerScope(
    'calendar',
    'https://www.googleapis.com/auth/calendar.events'
  );

  scopeRegistry.registerScope(
    'calendar',
    'https://www.googleapis.com/auth/calendar.settings.readonly'
  );

  // Add full calendar access scope for managing events
  scopeRegistry.registerScope(
    'calendar',
    'https://www.googleapis.com/auth/calendar'
  );
}
