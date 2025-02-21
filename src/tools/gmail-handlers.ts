import { getGmailService } from '../modules/gmail/index.js';
import { validateEmail } from '../utils/account.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SendEmailParams } from '../modules/gmail/types.js';
import {
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams
} from '../modules/gmail/services/label.js';
import { getAccountManager } from '../modules/accounts/index.js';

// Singleton instances
let gmailService: ReturnType<typeof getGmailService>;
let accountManager: ReturnType<typeof getAccountManager>;

/**
 * Initialize required services
 */
async function initializeServices() {
  if (!gmailService) {
    gmailService = getGmailService();
    await gmailService.initialize();
  }
  
  if (!accountManager) {
    accountManager = getAccountManager();
  }
}

import { 
  GmailAttachment, 
  OutgoingGmailAttachment,
  IncomingGmailAttachment 
} from '../modules/gmail/types.js';

interface SearchEmailsParams {
  email: string;
  search?: {
    from?: string | string[];
    to?: string | string[];
    subject?: string;
    after?: string;
    before?: string;
    hasAttachment?: boolean;
    labels?: string[];
    excludeLabels?: string[];
    includeSpam?: boolean;
    isUnread?: boolean;
  };
  options?: {
    maxResults?: number;
    pageToken?: string;
    format?: 'full' | 'metadata' | 'minimal';
    includeHeaders?: boolean;
    threadedView?: boolean;
    sortOrder?: 'asc' | 'desc';
  };
  messageIds?: string[];
}

interface SendEmailRequestParams {
  email: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  attachments?: OutgoingGmailAttachment[];
}

interface ManageDraftParams {
  email: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'send';
  draftId?: string;
  data?: {
    to: string[];
    subject: string;
    body: string;
    cc?: string[];
    bcc?: string[];
    attachments?: OutgoingGmailAttachment[];
  };
}

export async function handleSearchWorkspaceEmails(params: SearchEmailsParams) {
  await initializeServices();
  const { email, search = {}, options = {}, messageIds } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await gmailService.getEmails({ email, search, options, messageIds });
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search emails: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleSendWorkspaceEmail(params: SendEmailRequestParams) {
  await initializeServices();
  const { email, to, subject, body, cc, bcc, attachments } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Sender email address is required'
    );
  }

  if (!to || !Array.isArray(to) || to.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'At least one recipient email address is required'
    );
  }

  if (!subject) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email subject is required'
    );
  }

  if (!body) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email body is required'
    );
  }

  validateEmail(email);
  to.forEach(validateEmail);
  if (cc) cc.forEach(validateEmail);
  if (bcc) bcc.forEach(validateEmail);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      const emailParams: SendEmailParams = {
        email,
        to,
        subject,
        body,
        cc,
        bcc,
        attachments: attachments?.map(attachment => {
          if (!attachment.content) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Attachment content is required for file: ${attachment.name}`
            );
          }
          return {
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            content: attachment.content
          } as OutgoingGmailAttachment;
        })
      };

      return await gmailService.sendEmail(emailParams);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleGetWorkspaceGmailSettings(params: { email: string }) {
  await initializeServices();
  const { email } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await gmailService.getWorkspaceGmailSettings({ email });
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get Gmail settings: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleManageWorkspaceDraft(params: ManageDraftParams) {
  await initializeServices();
  const { email, action, draftId, data } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  if (!action) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Action is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      switch (action) {
        case 'create':
          if (!data) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Draft data is required for create action'
            );
          }
          return await gmailService.manageDraft({
            email,
            action: 'create',
            data: {
              ...data,
              attachments: data.attachments?.map(attachment => {
                if (!attachment.content) {
                  throw new McpError(
                    ErrorCode.InvalidParams,
                    `Attachment content is required for file: ${attachment.name}`
                  );
                }
                return {
                  id: attachment.id,
                  name: attachment.name,
                  mimeType: attachment.mimeType,
                  size: attachment.size,
                  content: attachment.content
                } as OutgoingGmailAttachment;
              })
            }
          });

        case 'read':
          return await gmailService.manageDraft({
            email,
            action: 'read',
            draftId
          });

        case 'update':
          if (!draftId || !data) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Draft ID and data are required for update action'
            );
          }
          return await gmailService.manageDraft({
            email,
            action: 'update',
            draftId,
            data: {
              ...data,
              attachments: data.attachments?.map(attachment => {
                if (!attachment.content) {
                  throw new McpError(
                    ErrorCode.InvalidParams,
                    `Attachment content is required for file: ${attachment.name}`
                  );
                }
                return {
                  id: attachment.id,
                  name: attachment.name,
                  mimeType: attachment.mimeType,
                  size: attachment.size,
                  content: attachment.content
                } as OutgoingGmailAttachment;
              })
            }
          });

        case 'delete':
          if (!draftId) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Draft ID is required for delete action'
            );
          }
          return await gmailService.manageDraft({
            email,
            action: 'delete',
            draftId
          });

        case 'send':
          if (!draftId) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Draft ID is required for send action'
            );
          }
          return await gmailService.manageDraft({
            email,
            action: 'send',
            draftId
          });

        default:
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid action. Supported actions are: create, read, update, delete, send'
          );
      }
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to manage draft: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleManageWorkspaceLabel(params: ManageLabelParams) {
  await initializeServices();
  const { email } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await gmailService.manageLabel(params);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to manage label: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleManageWorkspaceLabelAssignment(params: ManageLabelAssignmentParams) {
  await initializeServices();
  const { email } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await gmailService.manageLabelAssignment(params);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to manage label assignment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}

export async function handleManageWorkspaceLabelFilter(params: ManageLabelFilterParams) {
  await initializeServices();
  const { email } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  validateEmail(email);

  return accountManager.withTokenRenewal(email, async () => {
    try {
      return await gmailService.manageLabelFilter(params);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to manage label filter: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}
