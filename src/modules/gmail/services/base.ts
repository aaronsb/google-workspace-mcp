import { google } from 'googleapis';
import { BaseGoogleService } from '../../../services/base/BaseGoogleService.js';
import {
  GetEmailsParams,
  SendEmailParams,
  SendEmailResponse,
  GetGmailSettingsParams,
  GetGmailSettingsResponse,
  GmailError,
  GmailModuleConfig,
  GetEmailsResponse,
  DraftResponse,
  GetDraftsResponse,
  Label,
  GetLabelsResponse,
  LabelFilter
} from '../types.js';

import {
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams
} from './label.js';
import { ManageDraftParams } from './draft.js';
import { EmailService } from './email.js';
import { SearchService } from './search.js';
import { DraftService } from './draft.js';
import { SettingsService } from './settings.js';
import { LabelService } from './label.js';
import { FilterService } from './filter.js';
import { AttachmentService } from '../../attachments/service.js';
import { DriveService } from '../../drive/service.js';

/**
 * Gmail service implementation extending BaseGoogleService for common auth handling.
 */
export class GmailService extends BaseGoogleService<ReturnType<typeof google.gmail>> {
  private emailService: EmailService;
  private searchService: SearchService;
  private draftService: DraftService;
  private settingsService: SettingsService;
  private labelService: LabelService;
  private filterService: FilterService;
  private driveService: DriveService;
  private attachmentService: AttachmentService;
  private initialized = false;
  
  constructor(config?: GmailModuleConfig) {
    super({ serviceName: 'Gmail', version: 'v1' });
    
    // Initialize core services in dependency order
    this.driveService = new DriveService();
    this.attachmentService = new AttachmentService(this.driveService);
    this.searchService = new SearchService();
    this.emailService = new EmailService(this.searchService, this.attachmentService, this.driveService);
    this.draftService = new DraftService(this.driveService);
    this.settingsService = new SettingsService();
    this.labelService = new LabelService();
    this.filterService = new FilterService();
  }

  /**
   * Initialize the Gmail service and all dependencies
   */
  public async initialize(): Promise<void> {
    try {
      await super.initialize();
      await this.driveService.ensureInitialized();
      this.initialized = true;
    } catch (error) {
      throw new GmailError(
        'Failed to initialize Gmail service',
        'INIT_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Ensures all services are properly initialized
   */
  private checkInitialized() {
    if (!this.initialized) {
      throw new GmailError(
        'Gmail service not initialized',
        'INIT_ERROR',
        'Please call init() before using the service'
      );
    }
  }

  /**
   * Gets an authenticated Gmail client for the specified account.
   */
  private async getGmailClient(email: string) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    return this.getAuthenticatedClient(
      email,
      (auth) => {
        const client = google.gmail({ version: 'v1', auth });
        
        // Update service instances with new client
        this.emailService.updateClient(client);
        this.draftService.updateClient(client);
        this.settingsService.updateClient(client);
        this.labelService.updateClient(client);
        this.filterService.updateClient(client);
        
        return client;
      }
    );
  }

  async getEmails(params: GetEmailsParams): Promise<GetEmailsResponse> {
    await this.getGmailClient(params.email);
    return this.emailService.getEmails(params);
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResponse> {
    await this.getGmailClient(params.email);
    return this.emailService.sendEmail(params);
  }

  async manageDraft(params: ManageDraftParams): Promise<DraftResponse | GetDraftsResponse | SendEmailResponse | void> {
    await this.getGmailClient(params.email);
    return this.draftService.manageDraft(params);
  }

  async getWorkspaceGmailSettings(params: GetGmailSettingsParams): Promise<GetGmailSettingsResponse> {
    await this.getGmailClient(params.email);
    return this.settingsService.getWorkspaceGmailSettings(params);
  }

  // Consolidated Label Management Methods
  async manageLabel(params: ManageLabelParams): Promise<Label | GetLabelsResponse | void> {
    await this.getGmailClient(params.email);
    return this.labelService.manageLabel(params);
  }

  async manageLabelAssignment(params: ManageLabelAssignmentParams): Promise<void> {
    await this.getGmailClient(params.email);
    return this.labelService.manageLabelAssignment(params);
  }

  async manageLabelFilter(params: ManageLabelFilterParams): Promise<LabelFilter | GetLabelsResponse | void> {
    await this.getGmailClient(params.email);
    return this.labelService.manageLabelFilter(params);
  }
}
