import { scopeRegistry } from '../../../modules/tools/scope-registry.js';
import { DRIVE_SCOPES, registerDriveScopes, validateDriveScopes } from '../scopes.js';

describe('Drive Scopes', () => {
  beforeEach(() => {
    // Clear any existing scopes
    jest.clearAllMocks();
  });

  describe('registerDriveScopes', () => {
    it('should register all drive scopes', () => {
      registerDriveScopes();
      const registeredScopes = scopeRegistry.getAllScopes();
      
      expect(registeredScopes).toContain(DRIVE_SCOPES.FULL);
      expect(registeredScopes).toContain(DRIVE_SCOPES.READONLY);
      expect(registeredScopes).toContain(DRIVE_SCOPES.FILE);
      expect(registeredScopes).toContain(DRIVE_SCOPES.METADATA);
      expect(registeredScopes).toContain(DRIVE_SCOPES.APPDATA);
    });
  });

  describe('validateDriveScopes', () => {
    it('should return true for valid scopes', () => {
      const validScopes = [
        DRIVE_SCOPES.FULL,
        DRIVE_SCOPES.READONLY,
        DRIVE_SCOPES.FILE
      ];
      expect(validateDriveScopes(validScopes)).toBe(true);
    });

    it('should return false for invalid scopes', () => {
      const invalidScopes = [
        DRIVE_SCOPES.FULL,
        'invalid.scope',
        DRIVE_SCOPES.FILE
      ];
      expect(validateDriveScopes(invalidScopes)).toBe(false);
    });

    it('should return true for empty scope array', () => {
      expect(validateDriveScopes([])).toBe(true);
    });
  });
});
