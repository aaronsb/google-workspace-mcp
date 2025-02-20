import { GmailService } from '../modules/gmail/index.js';
import { DriveService } from '../modules/drive/service.js';
import { AttachmentService } from '../modules/attachments/service.js';
import { SearchService } from '../modules/gmail/services/search.js';
import { EmailService } from '../modules/gmail/services/email.js';
import { validateEmail } from '../utils/account.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { SendEmailParams } from '../modules/gmail/types.js';

interface Attachment {
  driveFileId?: string;
  content?: string;
  name: string;
  mimeType: string;
  size?: number;
}

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
  attachments?: Attachment[];
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
    attachments?: Attachment[];
  };
}

const gmailService = new GmailService();
const driveService = new DriveService();
const attachmentService = new AttachmentService(driveService);
const searchService = new SearchService();
const emailService = new EmailService(searchService, attachmentService, driveService);

export async function searchEmails(params: SearchEmailsParams) {
  const { email, search = {}, options = {}, messageIds } = params;

  if (!email) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Email address is required'
    );
  }

  validateEmail(email);

  try {
    return await emailService.getEmails({ email, search, options, messageIds });
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to search emails: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function sendEmail(params: SendEmailRequestParams) {
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

  try {
    const emailParams: SendEmailParams = {
      email,
      to,
      subject,
      body,
      cc,
      bcc,
      attachments: attachments?.map(attachment => ({
        driveFileId: attachment.driveFileId,
        content: attachment.content,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size
      }))
    };

    return await emailService.sendEmail(emailParams);
  } catch (error) {
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function manageDraft(params: ManageDraftParams) {
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

  try {
    const draftService = gmailService.getDraftService();
    await draftService.initialize();

    switch (action) {
      case 'create':
        if (!data) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Draft data is required for create action'
          );
        }
        return await draftService.createDraft(email, {
          ...data,
          attachments: data.attachments?.map(attachment => ({
            driveFileId: attachment.driveFileId,
            content: attachment.content,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size
          }))
        });

      case 'read':
        if (!draftId) {
          return await draftService.listDrafts(email);
        }
        return await draftService.getDraft(email, draftId);

      case 'update':
        if (!draftId || !data) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Draft ID and data are required for update action'
          );
        }
        return await draftService.updateDraft(email, draftId, {
          ...data,
          attachments: data.attachments?.map(attachment => ({
            driveFileId: attachment.driveFileId,
            content: attachment.content,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size
          }))
        });

      case 'delete':
        if (!draftId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Draft ID is required for delete action'
          );
        }
        return await draftService.deleteDraft(email, draftId);

      case 'send':
        if (!draftId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Draft ID is required for send action'
          );
        }
        return await draftService.sendDraft(email, draftId);

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
}
