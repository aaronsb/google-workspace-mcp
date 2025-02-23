import { gmail_v1 } from 'googleapis';
import {
  Label,
  CreateLabelParams,
  UpdateLabelParams,
  DeleteLabelParams,
  GetLabelsParams,
  GetLabelsResponse,
  ModifyMessageLabelsParams,
  GmailError,
  CreateLabelFilterParams,
  GetLabelFiltersParams,
  GetLabelFiltersResponse,
  UpdateLabelFilterParams,
  DeleteLabelFilterParams,
  LabelFilterCriteria,
  LabelFilterActions,
  LabelFilter
} from '../types.js';
import {
  isValidGmailLabelColor,
  getNearestGmailLabelColor,
  LABEL_ERROR_MESSAGES
} from '../constants.js';

export type LabelAction = 'create' | 'read' | 'update' | 'delete';
export type LabelAssignmentAction = 'add' | 'remove';
export type LabelFilterAction = 'create' | 'read' | 'update' | 'delete';

export interface ManageLabelParams {
  action: LabelAction;
  email: string;
  labelId?: string;
  data?: {
    name?: string;
    messageListVisibility?: 'show' | 'hide';
    labelListVisibility?: 'labelShow' | 'labelHide' | 'labelShowIfUnread';
    color?: {
      textColor: string;
      backgroundColor: string;
    };
  };
}

export interface ManageLabelAssignmentParams {
  action: LabelAssignmentAction;
  email: string;
  messageId: string;
  labelIds: string[];
}

export interface ManageLabelFilterParams {
  action: LabelFilterAction;
  email: string;
  filterId?: string;
  labelId?: string;
  data?: {
    criteria: LabelFilterCriteria;
    actions: LabelFilterActions;
  };
}

export class LabelService {
  private client: gmail_v1.Gmail | null = null;

  updateClient(client: gmail_v1.Gmail) {
    this.client = client;
  }

  private ensureClient() {
    if (!this.client) {
      throw new GmailError(
        'Gmail client not initialized',
        'CLIENT_ERROR',
        'Please ensure the service is initialized with a valid client'
      );
    }
  }

  async manageLabel(params: ManageLabelParams): Promise<Label | GetLabelsResponse | void> {
    this.ensureClient();

    switch (params.action) {
      case 'create':
        if (!params.data?.name) {
          throw new GmailError(
            'Label name is required for creation',
            'VALIDATION_ERROR',
            'Please provide a name for the label'
          );
        }
        return this.createLabel({
          email: params.email,
          name: params.data.name,
          messageListVisibility: params.data.messageListVisibility,
          labelListVisibility: params.data.labelListVisibility,
          color: params.data.color
        });

      case 'read':
        if (params.labelId) {
          // Get specific label
          const response = await this.client?.users.labels.get({
            userId: params.email,
            id: params.labelId
          });
          if (!response?.data) {
            throw new GmailError(
              'Label not found',
              'NOT_FOUND_ERROR',
              `Label ${params.labelId} does not exist`
            );
          }
          return this.mapGmailLabel(response.data);
        } else {
          // Get all labels
          return this.getLabels({ email: params.email });
        }

      case 'update':
        if (!params.labelId) {
          throw new GmailError(
            'Label ID is required for update',
            'VALIDATION_ERROR',
            'Please provide a label ID'
          );
        }
        return this.updateLabel({
          email: params.email,
          labelId: params.labelId,
          ...params.data
        });

      case 'delete':
        if (!params.labelId) {
          throw new GmailError(
            'Label ID is required for deletion',
            'VALIDATION_ERROR',
            'Please provide a label ID'
          );
        }
        return this.deleteLabel({
          email: params.email,
          labelId: params.labelId
        });

      default:
        throw new GmailError(
          'Invalid label action',
          'VALIDATION_ERROR',
          `Action ${params.action} is not supported`
        );
    }
  }

  async manageLabelAssignment(params: ManageLabelAssignmentParams): Promise<void> {
    this.ensureClient();

    const modifyParams: ModifyMessageLabelsParams = {
      email: params.email,
      messageId: params.messageId,
      addLabelIds: params.action === 'add' ? params.labelIds : [],
      removeLabelIds: params.action === 'remove' ? params.labelIds : []
    };

    return this.modifyMessageLabels(modifyParams);
  }

  /**
   * Validate filter criteria to ensure all required fields are present and properly formatted
   */
  private validateFilterCriteria(criteria: LabelFilterCriteria): void {
    if (!criteria) {
      throw new GmailError(
        'Filter criteria is required',
        'VALIDATION_ERROR',
        'Please provide filter criteria'
      );
    }

    // At least one filtering condition must be specified
    const hasCondition = (criteria.from && criteria.from.length > 0) ||
      (criteria.to && criteria.to.length > 0) ||
      criteria.subject ||
      (criteria.hasWords && criteria.hasWords.length > 0) ||
      (criteria.doesNotHaveWords && criteria.doesNotHaveWords.length > 0) ||
      criteria.hasAttachment ||
      criteria.size;

    if (!hasCondition) {
      throw new GmailError(
        'Invalid filter criteria',
        'VALIDATION_ERROR',
        'At least one filtering condition must be specified (from, to, subject, hasWords, doesNotHaveWords, hasAttachment, or size)'
      );
    }

    // Validate email arrays
    if (criteria.from?.length) {
      criteria.from.forEach(email => {
        if (!email.includes('@')) {
          throw new GmailError(
            'Invalid email address in from criteria',
            'VALIDATION_ERROR',
            `Invalid email address: ${email}`
          );
        }
      });
    }

    if (criteria.to?.length) {
      criteria.to.forEach(email => {
        if (!email.includes('@')) {
          throw new GmailError(
            'Invalid email address in to criteria',
            'VALIDATION_ERROR',
            `Invalid email address: ${email}`
          );
        }
      });
    }

    // Validate size criteria if present
    if (criteria.size) {
      if (typeof criteria.size.size !== 'number' || criteria.size.size <= 0) {
        throw new GmailError(
          'Invalid size criteria',
          'VALIDATION_ERROR',
          'Size must be a positive number'
        );
      }
      if (!['larger', 'smaller'].includes(criteria.size.operator)) {
        throw new GmailError(
          'Invalid size operator',
          'VALIDATION_ERROR',
          'Size operator must be either "larger" or "smaller"'
        );
      }
    }
  }

  /**
   * Build Gmail API query string from filter criteria
   */
  private buildFilterQuery(criteria: LabelFilterCriteria): string {
    const conditions: string[] = [];

    if (criteria.from?.length) {
      conditions.push(`{${criteria.from.map(email => `from:${email}`).join(' OR ')}}`);
    }

    if (criteria.to?.length) {
      conditions.push(`{${criteria.to.map(email => `to:${email}`).join(' OR ')}}`);
    }

    if (criteria.subject) {
      conditions.push(`subject:"${criteria.subject}"`);
    }

    if (criteria.hasWords?.length) {
      conditions.push(`{${criteria.hasWords.join(' OR ')}}`);
    }

    if (criteria.doesNotHaveWords?.length) {
      conditions.push(`-{${criteria.doesNotHaveWords.join(' OR ')}}`);
    }

    if (criteria.hasAttachment) {
      conditions.push('has:attachment');
    }

    if (criteria.size) {
      conditions.push(`size${criteria.size.operator === 'larger' ? '>' : '<'}${criteria.size.size}`);
    }

    return conditions.join(' ');
  }

  async manageLabelFilter(params: ManageLabelFilterParams): Promise<LabelFilter | GetLabelFiltersResponse | void> {
    this.ensureClient();

    switch (params.action) {
      case 'create':
        if (!params.labelId) {
          throw new GmailError(
            'Label ID is required',
            'VALIDATION_ERROR',
            'Please provide a valid label ID'
          );
        }
        if (!params.data?.criteria || !params.data?.actions) {
          throw new GmailError(
            'Filter configuration is required',
            'VALIDATION_ERROR',
            'Please provide both criteria and actions for the filter'
          );
        }

        // Validate filter criteria
        this.validateFilterCriteria(params.data.criteria);

        return this.createLabelFilter({
          email: params.email,
          labelId: params.labelId,
          criteria: params.data.criteria,
          actions: params.data.actions
        });

      case 'read':
        return this.getLabelFilters({
          email: params.email,
          labelId: params.labelId
        });

      case 'update':
        if (!params.filterId || !params.labelId || !params.data?.criteria || !params.data?.actions) {
          throw new GmailError(
            'Missing required filter update data',
            'VALIDATION_ERROR',
            'Please provide filterId, labelId, criteria, and actions'
          );
        }
        return this.updateLabelFilter({
          email: params.email,
          filterId: params.filterId,
          labelId: params.labelId,
          criteria: params.data.criteria,
          actions: params.data.actions
        });

      case 'delete':
        if (!params.filterId) {
          throw new GmailError(
            'Filter ID is required for deletion',
            'VALIDATION_ERROR',
            'Please provide a filter ID'
          );
        }
        return this.deleteLabelFilter({
          email: params.email,
          filterId: params.filterId
        });

      default:
        throw new GmailError(
          'Invalid filter action',
          'VALIDATION_ERROR',
          `Action ${params.action} is not supported`
        );
    }
  }

  // Helper methods that implement the actual operations
  private async createLabel(params: CreateLabelParams): Promise<Label> {
    try {
      if (params.color) {
        const { textColor, backgroundColor } = params.color;
        if (!isValidGmailLabelColor(textColor, backgroundColor)) {
          const suggestedColor = getNearestGmailLabelColor(backgroundColor);
          throw new GmailError(
            LABEL_ERROR_MESSAGES.INVALID_COLOR,
            'COLOR_ERROR',
            LABEL_ERROR_MESSAGES.COLOR_SUGGESTION(backgroundColor, suggestedColor)
          );
        }
      }

      if (!this.client) {
        throw new GmailError(
          'Gmail client not initialized',
          'CLIENT_ERROR',
          'Please ensure the service is initialized with a valid client'
        );
      }

      const response = await this.client.users.labels.create({
        userId: params.email,
        requestBody: {
          name: params.name,
          messageListVisibility: params.messageListVisibility || 'show',
          labelListVisibility: params.labelListVisibility || 'labelShow',
          color: params.color && {
            textColor: params.color.textColor,
            backgroundColor: params.color.backgroundColor
          }
        }
      });

      if (!response?.data) {
        throw new GmailError(
          'No response data from create label request',
          'CREATE_ERROR',
          'Server returned empty response'
        );
      }

      return this.mapGmailLabel(response.data);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === '401') {
        throw new GmailError(
          'Authentication failed',
          'AUTH_ERROR',
          'Please re-authenticate your account'
        );
      }
      
      if (error instanceof Error && error.message.includes('Invalid grant')) {
        throw new GmailError(
          'Authentication token expired',
          'TOKEN_ERROR',
          'Please re-authenticate your account'
        );
      }

      throw new GmailError(
        'Failed to create label',
        'CREATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async getLabels(params: GetLabelsParams): Promise<GetLabelsResponse> {
    try {
      const response = await this.client?.users.labels.list({
        userId: params.email
      });

      if (!response?.data.labels) {
        return { labels: [] };
      }

      return {
        labels: response.data.labels.map(this.mapGmailLabel)
      };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to fetch labels',
        'FETCH_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async updateLabel(params: UpdateLabelParams): Promise<Label> {
    try {
      if (params.color) {
        const { textColor, backgroundColor } = params.color;
        if (!isValidGmailLabelColor(textColor, backgroundColor)) {
          const suggestedColor = getNearestGmailLabelColor(backgroundColor);
          throw new GmailError(
            LABEL_ERROR_MESSAGES.INVALID_COLOR,
            'COLOR_ERROR',
            LABEL_ERROR_MESSAGES.COLOR_SUGGESTION(backgroundColor, suggestedColor)
          );
        }
      }

      if (!this.client) {
        throw new GmailError(
          'Gmail client not initialized',
          'CLIENT_ERROR',
          'Please ensure the service is initialized with a valid client'
        );
      }

      const response = await this.client.users.labels.patch({
        userId: params.email,
        id: params.labelId,
        requestBody: {
          name: params.name,
          messageListVisibility: params.messageListVisibility,
          labelListVisibility: params.labelListVisibility,
          color: params.color && {
            textColor: params.color.textColor,
            backgroundColor: params.color.backgroundColor
          }
        }
      });

      if (!response?.data) {
        throw new GmailError(
          'No response data from update label request',
          'UPDATE_ERROR',
          'Server returned empty response'
        );
      }

      return this.mapGmailLabel(response.data);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === '401') {
        throw new GmailError(
          'Authentication failed',
          'AUTH_ERROR',
          'Please re-authenticate your account'
        );
      }
      
      if (error instanceof Error && error.message.includes('Invalid grant')) {
        throw new GmailError(
          'Authentication token expired',
          'TOKEN_ERROR',
          'Please re-authenticate your account'
        );
      }

      throw new GmailError(
        'Failed to update label',
        'UPDATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async deleteLabel(params: DeleteLabelParams): Promise<void> {
    try {
      await this.client?.users.labels.delete({
        userId: params.email,
        id: params.labelId
      });
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to delete label',
        'DELETE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async modifyMessageLabels(params: ModifyMessageLabelsParams): Promise<void> {
    try {
      await this.client?.users.messages.modify({
        userId: params.email,
        id: params.messageId,
        requestBody: {
          addLabelIds: params.addLabelIds,
          removeLabelIds: params.removeLabelIds
        }
      });
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to modify message labels',
        'MODIFY_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async createLabelFilter(params: CreateLabelFilterParams): Promise<LabelFilter> {
    try {
      // Build filter criteria for Gmail API
      const filterCriteria: gmail_v1.Schema$FilterCriteria = {
        from: params.criteria.from?.join(' OR ') || undefined,
        to: params.criteria.to?.join(' OR ') || undefined,
        subject: params.criteria.subject || undefined,
        query: this.buildFilterQuery(params.criteria),
        hasAttachment: params.criteria.hasAttachment || undefined,
        excludeChats: true,
        size: params.criteria.size ? Number(params.criteria.size.size) : undefined,
        sizeComparison: params.criteria.size?.operator || undefined
      };

      // Build filter action with initialized arrays
      const addLabelIds = [params.labelId];
      const removeLabelIds: string[] = [];

      // Add system label modifications based on actions
      if (params.actions.markImportant) {
        addLabelIds.push('IMPORTANT');
      }
      if (params.actions.markRead) {
        removeLabelIds.push('UNREAD');
      }
      if (params.actions.archive) {
        removeLabelIds.push('INBOX');
      }

      const filterAction: gmail_v1.Schema$FilterAction = {
        addLabelIds,
        removeLabelIds,
        forward: undefined
      };

      // Create the filter
      const response = await this.client?.users.settings.filters.create({
        userId: params.email,
        requestBody: {
          criteria: filterCriteria,
          action: filterAction
        }
      });

      if (!response?.data) {
        throw new GmailError(
          'Failed to create filter',
          'CREATE_ERROR',
          'No response data received from Gmail API'
        );
      }

      // Return the created filter in our standard format
      return {
        id: response.data.id || '',
        labelId: params.labelId,
        criteria: params.criteria,
        actions: params.actions
      };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to create label filter',
        'CREATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async getLabelFilters(params: GetLabelFiltersParams): Promise<GetLabelFiltersResponse> {
    try {
      const response = await this.client?.users.settings.filters.list({
        userId: params.email
      });

      if (!response?.data.filter) {
        return { filters: [] };
      }

      // Map Gmail API filters to our format
      const filters = response.data.filter
        .filter(filter => {
          if (!filter.action?.addLabelIds?.length) return false;
          // If labelId is provided, only return filters for that label
          if (params.labelId) {
            return filter.action.addLabelIds.includes(params.labelId);
          }
          return true;
        })
        .map(filter => ({
          id: filter.id || '',
          labelId: filter.action?.addLabelIds?.[0] || '',
          criteria: {
            from: filter.criteria?.from ? filter.criteria.from.split(' OR ') : undefined,
            to: filter.criteria?.to ? filter.criteria.to.split(' OR ') : undefined,
            subject: filter.criteria?.subject || undefined,
            hasAttachment: filter.criteria?.hasAttachment || undefined,
            hasWords: filter.criteria?.query ? [filter.criteria.query] : undefined,
            doesNotHaveWords: filter.criteria?.negatedQuery ? [filter.criteria.negatedQuery] : undefined,
            size: filter.criteria?.size && filter.criteria?.sizeComparison ? {
              operator: filter.criteria.sizeComparison as 'larger' | 'smaller',
              size: Number(filter.criteria.size)
            } : undefined
          },
          actions: {
            addLabel: true,
            markImportant: filter.action?.addLabelIds?.includes('IMPORTANT') || false,
            markRead: filter.action?.removeLabelIds?.includes('UNREAD') || false,
            archive: filter.action?.removeLabelIds?.includes('INBOX') || false
          }
        }));

      return { filters };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to get label filters',
        'FETCH_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async updateLabelFilter(params: UpdateLabelFilterParams): Promise<LabelFilter> {
    try {
      // Gmail API doesn't support direct filter updates, so we need to delete and recreate
      await this.deleteLabelFilter({
        email: params.email,
        filterId: params.filterId
      });

      // Convert our criteria format to Gmail API format
      const criteria: gmail_v1.Schema$FilterCriteria = {
        from: params.criteria.from?.join(' OR ') || null,
        to: params.criteria.to?.join(' OR ') || null,
        subject: params.criteria.subject || null,
        query: params.criteria.hasWords?.join(' OR ') || null,
        negatedQuery: params.criteria.doesNotHaveWords?.join(' OR ') || null,
        hasAttachment: params.criteria.hasAttachment || null,
        size: params.criteria.size?.size || null,
        sizeComparison: params.criteria.size?.operator || null
      };

      // Initialize arrays for label IDs
      const addLabelIds: string[] = [params.labelId];
      const removeLabelIds: string[] = [];

      // Add additional label IDs based on actions
      if (params.actions.markImportant) {
        addLabelIds.push('IMPORTANT');
      }
      if (params.actions.markRead) {
        removeLabelIds.push('UNREAD');
      }
      if (params.actions.archive) {
        removeLabelIds.push('INBOX');
      }

      // Create the filter action
      const action: gmail_v1.Schema$FilterAction = {
        addLabelIds,
        removeLabelIds,
        forward: null
      };

      const response = await this.client?.users.settings.filters.create({
        userId: params.email,
        requestBody: {
          criteria,
          action
        }
      });
      if (!response?.data) {
        throw new GmailError(
          'No response data from update filter request',
          'UPDATE_ERROR',
          'Server returned empty response'
        );
      }
      // Map response to our LabelFilter format
      return {
        id: response.data.id || '',
        labelId: params.labelId,
        criteria: params.criteria,
        actions: params.actions
      };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to update label filter',
        'UPDATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async deleteLabelFilter(params: DeleteLabelFilterParams): Promise<void> {
    try {
      await this.client?.users.settings.filters.delete({
        userId: params.email,
        id: params.filterId
      });
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to delete label filter',
        'DELETE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private mapGmailLabel(label: gmail_v1.Schema$Label): Label {
    const mappedLabel: Label = {
      id: label.id || '',
      name: label.name || '',
      type: (label.type || 'user') as 'system' | 'user',
      messageListVisibility: (label.messageListVisibility || 'show') as 'hide' | 'show',
      labelListVisibility: (label.labelListVisibility || 'labelShow') as 'labelHide' | 'labelShow' | 'labelShowIfUnread'
    };

    if (label.color?.textColor && label.color?.backgroundColor) {
      mappedLabel.color = {
        textColor: label.color.textColor,
        backgroundColor: label.color.backgroundColor
      };
    }

    return mappedLabel;
  }
}
