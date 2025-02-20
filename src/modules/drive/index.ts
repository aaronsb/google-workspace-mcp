import { DriveService } from './service.js';
import { registerDriveScopes } from './scopes.js';
import { DriveOperationResult } from './types.js';

// Export types and service
export * from './types.js';
export * from './scopes.js';

// Singleton instance
let driveService: DriveService | undefined;

export function getDriveService(): DriveService {
  if (!driveService) {
    driveService = new DriveService();
  }
  return driveService;
}

// Initialize module
export async function initializeDriveModule(): Promise<void> {
  // Get service instance (creates if not exists)
  getDriveService();
}

// Helper to handle errors consistently
export function handleDriveError(error: unknown): DriveOperationResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error occurred',
  };
}
