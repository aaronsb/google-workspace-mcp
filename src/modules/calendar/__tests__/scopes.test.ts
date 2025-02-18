import { registerCalendarScopes, CALENDAR_SCOPES } from '../scopes.js';
import { scopeRegistry } from '../../tools/scope-registry.js';

describe('Calendar Scopes', () => {
  beforeEach(() => {
    // Reset the scope registry before each test
    // @ts-ignore - accessing private property for testing
    scopeRegistry.scopes = new Map();
    // @ts-ignore - accessing private property for testing
    scopeRegistry.scopeOrder = [];
  });

  it('should register all required Calendar scopes', () => {
    registerCalendarScopes();
    const registeredScopes = scopeRegistry.getAllScopes();
    
    // Required scopes for Calendar functionality
    const requiredScopes = [
      CALENDAR_SCOPES.READONLY,         // For viewing events
      CALENDAR_SCOPES.EVENTS,           // For creating/modifying events
      CALENDAR_SCOPES.SETTINGS_READONLY, // For calendar settings
      CALENDAR_SCOPES.FULL_ACCESS       // For full calendar management
    ];

    // Verify each required scope is registered
    requiredScopes.forEach(scope => {
      expect(registeredScopes).toContain(scope);
    });
  });

  it('should register scopes in correct order', () => {
    registerCalendarScopes();
    const registeredScopes = scopeRegistry.getAllScopes();

    // Core functionality scopes should come first
    const coreScopes = [
      CALENDAR_SCOPES.READONLY
    ];

    // Feature-specific scopes should come next
    const featureScopes = [
      CALENDAR_SCOPES.EVENTS,
      CALENDAR_SCOPES.FULL_ACCESS
    ];

    // Settings scopes should come last
    const settingsScopes = [
      CALENDAR_SCOPES.SETTINGS_READONLY
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
    registerCalendarScopes();
    const initialScopes = scopeRegistry.getAllScopes();

    // Register scopes second time
    registerCalendarScopes();
    const finalScopes = scopeRegistry.getAllScopes();

    // Verify all scopes are still registered in same order
    expect(finalScopes).toEqual(initialScopes);
  });
});
