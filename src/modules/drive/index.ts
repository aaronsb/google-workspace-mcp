import { DriveService } from './service.js';
import { registerDriveScopes } from './scopes.js';
import { DriveOperationResult } from './types.js';

// Export types and service
export * from './types.js';
export * from './scopes.js';

// Singleton instance
let driveService: DriveService | undefined;

export async function getDriveService(): Promise<DriveService> {
  if (!driveService) {
    driveService = new DriveService();
    await driveService.ensureInitialized();
  }
  return driveService;
}

// Initialize module
export async function initializeDriveModule(): Promise<void> {
  const service = await getDriveService();
  await service.ensureInitialized();
}

// Helper to handle errors consistently
export function handleDriveError(error: unknown): DriveOperationResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error occurred',
  };
}
