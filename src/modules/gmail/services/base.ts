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
  GetLabelFiltersResponse,
  LabelFilter
} from '../types.js';
import { AttachmentIndexService } from '../../attachments/index-service.js';

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
import { GmailAttachmentService } from './attachment.js';

/**
 * Gmail service implementation extending BaseGoogleService for common auth handling.
 */
export class GmailService extends BaseGoogleService<ReturnType<typeof google.gmail>> {
  private emailService: EmailService;
  private searchService: SearchService;
  private draftService: DraftService;
  private settingsService: SettingsService;
  private labelService: LabelService;
  private attachmentService: GmailAttachmentService;
  private initialized = false;
  
  constructor(config?: GmailModuleConfig) {
    super({ serviceName: 'Gmail', version: 'v1' });
    
    this.searchService = new SearchService();
    this.attachmentService = GmailAttachmentService.getInstance();
    this.emailService = new EmailService(this.searchService, this.attachmentService);
    this.draftService = new DraftService(this.attachmentService);
    this.settingsService = new SettingsService();
    this.labelService = new LabelService();
  }

  private async ensureInitialized(email: string) {
    if (!this.initialized) {
      await this.initialize();
    }
    await this.getGmailClient(email);
  }

  /**
   * Initialize the Gmail service
   */
  public async initialize(): Promise<void> {
    try {
      await super.initialize();
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
        this.attachmentService.updateClient(client);
        
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

  async manageLabelFilter(params: ManageLabelFilterParams): Promise<LabelFilter | GetLabelFiltersResponse | void> {
    await this.getGmailClient(params.email);
    return this.labelService.manageLabelFilter(params);
  }

  async getAttachment(email: string, messageId: string, filename: string) {
    await this.ensureInitialized(email);
    return this.attachmentService.getAttachment(email, messageId, filename);
  }
}
