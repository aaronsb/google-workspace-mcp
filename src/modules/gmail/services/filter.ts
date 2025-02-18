import { gmail_v1 } from 'googleapis';
import {
  LabelFilter,
  CreateLabelFilterParams,
  UpdateLabelFilterParams,
  DeleteLabelFilterParams,
  GetLabelFiltersParams,
  GetLabelFiltersResponse,
  GmailError
} from '../types.js';

export class FilterService {
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

  /**
   * Convert filter criteria to Gmail API query string
   */
  private buildQueryString(criteria: LabelFilter['criteria']): string {
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

  /**
   * Create a new filter for a label
   */
  async createFilter(params: CreateLabelFilterParams): Promise<LabelFilter> {
    this.ensureClient();
    try {
      // Convert our criteria to Gmail's filter criteria format
      const filterCriteria: gmail_v1.Schema$FilterCriteria = {
        from: params.criteria.from?.join(' OR '),
        to: params.criteria.to?.join(' OR '),
        subject: params.criteria.subject || undefined,
        query: this.buildQueryString(params.criteria),
        hasAttachment: params.criteria.hasAttachment || undefined,
        excludeChats: true,
        size: params.criteria.size ? Number(params.criteria.size.size) : undefined,
        sizeComparison: params.criteria.size?.operator || undefined
      };

      const response = await this.client?.users.settings.filters.create({
        userId: params.email,
        requestBody: {
          criteria: filterCriteria,
          action: {
            addLabelIds: params.actions.addLabel ? [params.labelId] : undefined,
            removeLabelIds: [],
            forward: undefined // Gmail API requires this to be explicitly undefined
          }
        }
      });

      if (!response?.data) {
        throw new GmailError(
          'No response data from create filter request',
          'CREATE_ERROR',
          'Server returned empty response'
        );
      }

      return {
        id: response.data.id || '',
        labelId: params.labelId,
        criteria: params.criteria,
        actions: params.actions
      };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to create filter',
        'CREATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Get all filters for a label
   */
  async getFilters(params: GetLabelFiltersParams): Promise<GetLabelFiltersResponse> {
    this.ensureClient();
    try {
      const response = await this.client?.users.settings.filters.list({
        userId: params.email
      });

      if (!response?.data.filter) {
        return { filters: [] };
      }

      const filters = (response.data.filter || [])
        .filter(filter => {
          if (!filter || !filter.action) return false;
          // If labelId is provided, only return filters for that label
          if (params.labelId) {
            return filter.action.addLabelIds?.includes(params.labelId);
          }
          return true;
        })
        .map(filter => {
          const criteria = filter.criteria || {};
          return {
            id: filter.id || '',
            labelId: filter.action?.addLabelIds?.[0] || '',
            criteria: {
              from: criteria.from ? criteria.from.split(' OR ') : undefined,
              to: criteria.to ? criteria.to.split(' OR ') : undefined,
              subject: criteria.subject || undefined,
              hasAttachment: criteria.hasAttachment || undefined,
              hasWords: criteria.query ? [criteria.query] : undefined,
              size: criteria.size && criteria.sizeComparison ? {
                operator: criteria.sizeComparison as 'larger' | 'smaller',
                size: Number(criteria.size)
              } : undefined,
              doesNotHaveWords: undefined
            },
            actions: {
              addLabel: !!filter.action?.addLabelIds?.length,
              // Gmail API doesn't support these actions directly
              markImportant: false,
              markRead: false,
              archive: false
            }
          };
        });

      return { filters };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to fetch filters',
        'FETCH_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Update an existing filter
   */
  async updateFilter(params: UpdateLabelFilterParams): Promise<LabelFilter> {
    this.ensureClient();
    try {
      // First get the existing filter
      const existingFilter = await this.client?.users.settings.filters.get({
        userId: params.email,
        id: params.filterId
      });

      if (!existingFilter?.data) {
        throw new GmailError(
          'Filter not found',
          'UPDATE_ERROR',
          `No filter found with ID ${params.filterId}`
        );
      }

      // Delete the old filter
      await this.client?.users.settings.filters.delete({
        userId: params.email,
        id: params.filterId
      });

      // Convert criteria to Gmail's format
      // Use existing criteria as fallback if no new criteria provided
      const criteria = params.criteria || {
        from: existingFilter.data.criteria?.from ? [existingFilter.data.criteria.from] : undefined,
        to: existingFilter.data.criteria?.to ? [existingFilter.data.criteria.to] : undefined,
        subject: existingFilter.data.criteria?.subject || undefined,
        hasAttachment: existingFilter.data.criteria?.hasAttachment || undefined,
        hasWords: existingFilter.data.criteria?.query ? [existingFilter.data.criteria.query] : undefined,
        size: existingFilter.data.criteria?.size && existingFilter.data.criteria.sizeComparison ? {
          operator: existingFilter.data.criteria.sizeComparison as 'larger' | 'smaller',
          size: Number(existingFilter.data.criteria.size)
        } : undefined,
        doesNotHaveWords: undefined
      };

      const filterCriteria: gmail_v1.Schema$FilterCriteria = {
        from: criteria.from?.join(' OR '),
        to: criteria.to?.join(' OR '),
        subject: criteria.subject,
        query: this.buildQueryString(criteria),
        hasAttachment: criteria.hasAttachment,
        excludeChats: true,
        size: criteria.size ? Number(criteria.size.size) : undefined,
        sizeComparison: criteria.size?.operator || undefined
      };

      // Create new filter with updated settings
      const response = await this.client?.users.settings.filters.create({
        userId: params.email,
        requestBody: {
          criteria: filterCriteria,
          action: {
            addLabelIds: params.actions?.addLabel 
              ? [existingFilter.data.action?.addLabelIds?.[0] || ''] 
              : undefined,
            removeLabelIds: [],
            forward: undefined
          }
        }
      });

      if (!response?.data) {
        throw new GmailError(
          'No response data from update filter request',
          'UPDATE_ERROR',
          'Server returned empty response'
        );
      }

      return {
        id: response.data.id || '',
        labelId: existingFilter.data.action?.addLabelIds?.[0] || '',
        criteria: params.criteria || {
          from: existingFilter.data.criteria?.from ? [existingFilter.data.criteria.from] : undefined,
          to: existingFilter.data.criteria?.to ? [existingFilter.data.criteria.to] : undefined,
          subject: existingFilter.data.criteria?.subject || undefined,
          hasAttachment: existingFilter.data.criteria?.hasAttachment || undefined,
          hasWords: existingFilter.data.criteria?.query ? [existingFilter.data.criteria.query] : undefined,
          size: existingFilter.data.criteria?.size && existingFilter.data.criteria.sizeComparison ? {
            operator: existingFilter.data.criteria.sizeComparison as 'larger' | 'smaller',
            size: Number(existingFilter.data.criteria.size)
          } : undefined,
          doesNotHaveWords: undefined
        },
        actions: {
          addLabel: params.actions?.addLabel ?? !!existingFilter.data.action?.addLabelIds?.length,
          // Gmail API doesn't support these actions, so we maintain default values
          markImportant: false,
          markRead: false,
          archive: false
        }
      };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to update filter',
        'UPDATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Delete a filter
   */
  async deleteFilter(params: DeleteLabelFilterParams): Promise<void> {
    this.ensureClient();
    try {
      await this.client?.users.settings.filters.delete({
        userId: params.email,
        id: params.filterId
      });
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to delete filter',
        'DELETE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }
}
