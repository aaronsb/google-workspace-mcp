import { gmail_v1 } from 'googleapis';
import {
  Label,
  CreateLabelParams,
  UpdateLabelParams,
  DeleteLabelParams,
  GetLabelsParams,
  GetLabelsResponse,
  ModifyMessageLabelsParams,
  GmailError
} from '../types.js';
import {
  isValidGmailLabelColor,
  getNearestGmailLabelColor,
  LABEL_ERROR_MESSAGES
} from '../constants.js';

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

  /**
   * Get all labels in the user's mailbox
   */
  async getLabels(params: GetLabelsParams): Promise<GetLabelsResponse> {
    this.ensureClient();
    try {
      const response = await this.client?.users.labels.list({
        userId: params.email
      });

      if (!response?.data.labels) {
        return { labels: [] };
      }

      return {
        labels: response.data.labels.map(label => {
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
        })
      };
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to fetch labels',
        'FETCH_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Create a new label
   */
  async createLabel(params: CreateLabelParams): Promise<Label> {
    this.ensureClient();
    try {
      // Validate colors if provided
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

      const response = await this.client?.users.labels.create({
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

      const label = response.data;
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
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to create label',
        'CREATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Update an existing label
   */
  async updateLabel(params: UpdateLabelParams): Promise<Label> {
    this.ensureClient();
    try {
      // Validate colors if provided
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

      const response = await this.client?.users.labels.patch({
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

      const label = response.data;
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
    } catch (error: unknown) {
      throw new GmailError(
        'Failed to update label',
        'UPDATE_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Delete a label
   */
  async deleteLabel(params: DeleteLabelParams): Promise<void> {
    this.ensureClient();
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

  /**
   * Modify labels on a message
   */
  async modifyMessageLabels(params: ModifyMessageLabelsParams): Promise<void> {
    this.ensureClient();
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
}
