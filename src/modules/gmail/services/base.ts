import { google } from 'googleapis';
import { BaseGoogleService } from '../../../services/base/BaseGoogleService.js';
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
  SendDraftParams,
  Label,
  GetLabelsParams,
  GetLabelsResponse,
  CreateLabelParams,
  UpdateLabelParams,
  DeleteLabelParams,
  ModifyMessageLabelsParams,
  CreateLabelFilterParams,
  UpdateLabelFilterParams,
  DeleteLabelFilterParams,
  GetLabelFiltersParams,
  GetLabelFiltersResponse,
  LabelFilter
} from '../types.js';
import { EmailService } from './email.js';
import { SearchService } from './search.js';
import { DraftService } from './draft.js';
import { SettingsService } from './settings.js';
import { LabelService } from './label.js';
import { FilterService } from './filter.js';

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
  
  constructor(config?: GmailModuleConfig) {
    super({ serviceName: 'Gmail', version: 'v1' });
    
    // Initialize core services in dependency order
    this.searchService = new SearchService();
    this.emailService = new EmailService(this.searchService);
    this.draftService = new DraftService(this.emailService);
    this.settingsService = new SettingsService();
    this.labelService = new LabelService();
    this.filterService = new FilterService();

  }

  /**
   * Initialize the Gmail service
   */
  public async init(): Promise<void> {
    try {
      await this.initialize();
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
  private ensureServices() {
    if (!this.emailService || !this.draftService || !this.settingsService || !this.labelService || !this.filterService) {
      throw new GmailError(
        'Gmail services not initialized',
        'SERVICE_ERROR',
        'Please ensure the service is initialized'
      );
    }
  }

  /**
   * Gets an authenticated Gmail client for the specified account.
   */
  private async getGmailClient(email: string) {
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
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.emailService.sendEmail(params);
  }

  async createDraft(params: DraftEmailParams): Promise<DraftResponse> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.draftService.createDraft(params);
  }

  async getDrafts(params: GetDraftsParams): Promise<GetDraftsResponse> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.draftService.getDrafts(params);
  }

  async sendDraft(params: SendDraftParams): Promise<SendEmailResponse> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.draftService.sendDraft(params);
  }

  async getWorkspaceGmailSettings(params: GetGmailSettingsParams): Promise<GetGmailSettingsResponse> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.settingsService.getWorkspaceGmailSettings(params);
  }

  async getLabels(params: GetLabelsParams): Promise<GetLabelsResponse> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.labelService.getLabels(params);
  }

  async createLabel(params: CreateLabelParams): Promise<Label> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.labelService.createLabel(params);
  }

  async updateLabel(params: UpdateLabelParams): Promise<Label> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.labelService.updateLabel(params);
  }

  async deleteLabel(params: DeleteLabelParams): Promise<void> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.labelService.deleteLabel(params);
  }

  async modifyMessageLabels(params: ModifyMessageLabelsParams): Promise<void> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.labelService.modifyMessageLabels(params);
  }

  // Label Filter Methods
  async createLabelFilter(params: CreateLabelFilterParams): Promise<LabelFilter> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.filterService.createFilter(params);
  }

  async getLabelFilters(params: GetLabelFiltersParams): Promise<GetLabelFiltersResponse> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.filterService.getFilters(params);
  }

  async updateLabelFilter(params: UpdateLabelFilterParams): Promise<LabelFilter> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.filterService.updateFilter(params);
  }

  async deleteLabelFilter(params: DeleteLabelFilterParams): Promise<void> {
    this.ensureServices();
    await this.getGmailClient(params.email);
    return this.filterService.deleteFilter(params);
  }
}
