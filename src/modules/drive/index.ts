import { driveService } from '../../services/drive/index.js';
import { DriveService } from './service.js';
import { DriveOperationResult } from './types.js';

// Export types and service
export * from './types.js';
export * from './scopes.js';
export { DriveService };

// Get singleton instance
let serviceInstance: DriveService | undefined;

export async function getDriveService(): Promise<DriveService> {
  if (!serviceInstance) {
    serviceInstance = driveService;
    await serviceInstance.ensureInitialized();
  }
  return serviceInstance;
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
