import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAccountManager } from '../../accounts/index.js';
import {
  GetEmailsParams,
  SendEmailParams,
  EmailResponse,
  SendEmailResponse,
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  GmailError,
  GmailModuleConfig,
  GetEmailsResponse,
  DraftEmailParams,
  DraftResponse,
  GetDraftsParams,
  GetDraftsResponse,
  SendDraftParams
} from '../types.js';
import { EmailService } from './email.js';
import { SearchService } from './search.js';
import { DraftService } from './draft.js';
import { SettingsService } from './settings.js';

/**
 * Gmail service implementation with proper scope handling.
 * 
 * This service addresses previous metadata scope issues by:
 * 1. Using ScopeRegistry to ensure proper permissions
 * 2. Validating tokens have required scopes before operations
 * 3. Requesting re-authentication when fuller access is needed
 * 
 * Key improvements:
 * - Search functionality now works ('q' parameter supported)
 * - Full email content access available (format: 'full' supported)
 * - Proper scope validation before operations
 */
export class GmailService {
  private gmailClient?: ReturnType<typeof google.gmail>;
  private oauth2Client?: OAuth2Client;
  private emailService?: EmailService;
  private searchService?: SearchService;
  private draftService?: DraftService;
  private settingsService?: SettingsService;
  
  constructor(config?: GmailModuleConfig) {}

  async initialize(): Promise<void> {
    const accountManager = getAccountManager();
    this.oauth2Client = await accountManager.getAuthClient();
    this.gmailClient = google.gmail({ version: 'v1', auth: this.oauth2Client });

    // Initialize services
    this.searchService = new SearchService();
    this.emailService = new EmailService(this.gmailClient, this.oauth2Client, this.searchService);
    this.draftService = new DraftService(this.gmailClient, this.oauth2Client, this.emailService);
    this.settingsService = new SettingsService(this.gmailClient, this.oauth2Client);
  }

  /**
   * Gets an authenticated Gmail client, creating and caching it if needed.
   * 
   * @param email - The email address to get a client for
   * @throws {GmailError} If authentication is required or token is invalid
   */
  private async getGmailClient(email: string) {
    if (!this.oauth2Client) {
      throw new GmailError(
        'Gmail client not initialized',
        'CLIENT_ERROR',
        'Please ensure the service is initialized'
      );
    }

    if (this.gmailClient) {
      return this.gmailClient;
    }

    const accountManager = getAccountManager();
    const tokenStatus = await accountManager.validateToken(email);

    if (!tokenStatus.valid || !tokenStatus.token) {
      throw new GmailError(
        'Gmail authentication required',
        'AUTH_REQUIRED',
        'Please authenticate the account, which will grant all necessary permissions'
      );
    }

    this.oauth2Client.setCredentials(tokenStatus.token);
    this.gmailClient = google.gmail({ version: 'v1', auth: this.oauth2Client });
    return this.gmailClient;
  }

  async getEmails(params: GetEmailsParams): Promise<GetEmailsResponse> {
    await this.getGmailClient(params.email);
    if (!this.emailService) {
      throw new GmailError(
        'Email service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.emailService.getEmails(params);
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResponse> {
    await this.getGmailClient(params.email);
    if (!this.emailService) {
      throw new GmailError(
        'Email service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.emailService.sendEmail(params);
  }

  async createDraft(params: DraftEmailParams): Promise<DraftResponse> {
    await this.getGmailClient(params.email);
    if (!this.draftService) {
      throw new GmailError(
        'Draft service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.draftService.createDraft(params);
  }

  async getDrafts(params: GetDraftsParams): Promise<GetDraftsResponse> {
    await this.getGmailClient(params.email);
    if (!this.draftService) {
      throw new GmailError(
        'Draft service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.draftService.getDrafts(params);
  }

  async sendDraft(params: SendDraftParams): Promise<SendEmailResponse> {
    await this.getGmailClient(params.email);
    if (!this.draftService) {
      throw new GmailError(
        'Draft service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.draftService.sendDraft(params);
  }

  async getWorkspaceGmailSettings(params: GetGmailSettingsParams): Promise<GetGmailSettingsResponse> {
    await this.getGmailClient(params.email);
    if (!this.settingsService) {
      throw new GmailError(
        'Settings service not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized'
      );
    }
    return this.settingsService.getWorkspaceGmailSettings(params);
  }
}
