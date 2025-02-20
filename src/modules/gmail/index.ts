import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAccountManager } from '../accounts/index.js';
import { DriveService } from '../drive/service.js';
import { DraftService } from './services/draft.js';
import { GmailError } from './types.js';

export class GmailService {
  private oauth2Client!: OAuth2Client;
  private driveService?: DriveService;
  private draftService?: DraftService;
  private initialized = false;

  constructor() {}

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
      this.driveService = new DriveService();
      this.draftService = new DraftService(this.driveService);
      this.initialized = true;
    }
  }

  async initialize(): Promise<void> {
    const accountManager = getAccountManager();
    this.oauth2Client = await accountManager.getAuthClient();
  }

  private async getGmailClient(email: string) {
    await this.ensureInitialized();
    const accountManager = getAccountManager();
    try {
      const tokenStatus = await accountManager.validateToken(email);
      if (!tokenStatus.valid || !tokenStatus.token) {
        throw new GmailError(
          'Gmail authentication required',
          'AUTH_REQUIRED',
          'Please authenticate to access Gmail'
        );
      }

      this.oauth2Client.setCredentials(tokenStatus.token);
      const client = google.gmail({ version: 'v1', auth: this.oauth2Client });
      if (!this.draftService) {
        throw new GmailError(
          'Gmail service not initialized',
          'SERVICE_ERROR',
          'Please ensure the service is initialized before using Gmail client'
        );
      }
      this.draftService.updateClient(client);
      return client;
    } catch (error) {
      if (error instanceof GmailError) {
        throw error;
      }
      throw new GmailError(
        'Failed to initialize Gmail client',
        'AUTH_ERROR',
        'Please try again or contact support if the issue persists'
      );
    }
  }

  getDraftService(): DraftService {
    if (!this.draftService) {
      throw new GmailError(
        'Gmail service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized before accessing drafts'
      );
    }
    return this.draftService;
  }
}

export { GmailError } from './types.js';
export { DraftService } from './services/draft.js';

export async function initializeGmailModule(): Promise<void> {
  const service = new GmailService();
  await service.initialize();
}
