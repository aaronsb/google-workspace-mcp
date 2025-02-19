import { getAccountManager } from '../modules/accounts/index.js';
import { getGmailService } from '../modules/gmail/index.js';
import {
  McpToolResponse,
  GmailSearchParams,
  BaseToolArguments,
  SendEmailArgs
} from './types.js';

import {
  ManageLabelParams,
  ManageLabelAssignmentParams,
  ManageLabelFilterParams,
  ManageDraftParams
} from '../modules/gmail/types.js';

/**
 * Search emails in a Gmail account with advanced filtering
 * @param args.email - Gmail account to search
 * @param args.search - Search criteria (from, to, subject, dates, etc.)
 * @param args.maxResults - Maximum number of results to return
 * @returns Filtered list of emails matching search criteria
 * @throws {McpError} If search fails or token renewal fails
 */
export async function handleSearchWorkspaceEmails(args: GmailSearchParams): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const params: GmailSearchParams = {
      email: args.email,
      search: args.search || {},
      options: args.options || {}
    };
    const emails = await getGmailService().getEmails(params);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(emails, null, 2)
      }]
    };
  });
}


/**
 * Send an email from a Gmail account
 * @param args.email - Sender's Gmail address
 * @param args.to - Recipient email addresses
 * @param args.subject - Email subject
 * @param args.body - Email content (supports HTML)
 * @param args.cc - Optional CC recipients
 * @param args.bcc - Optional BCC recipients
 * @returns Message ID and thread ID of sent email
 * @throws {McpError} If sending fails or token renewal fails
 */
export async function handleSendWorkspaceEmail(args: SendEmailArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().sendEmail(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

/**
 * Get Gmail settings and profile information
 * @param args.email - Gmail account to get settings for
 * @returns Account settings including filters, forwarding, IMAP/POP settings
 * @throws {McpError} If settings retrieval fails
 */
export async function handleGetWorkspaceGmailSettings(args: BaseToolArguments): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().getWorkspaceGmailSettings(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}


/**
 * Manage Gmail drafts with CRUD operations and sending
 * @param args.email - Gmail account to manage drafts for
 * @param args.action - Operation to perform (create/read/update/delete/send)
 * @param args.draftId - Draft ID for operations other than create
 * @param args.data - Draft content for create/update operations
 * @returns Operation result (varies by action)
 * @throws {McpError} If operation fails
 */
export async function handleManageWorkspaceDraft(args: ManageDraftParams): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().manageDraft(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

// Label Management Handlers
export async function handleManageWorkspaceLabel(args: ManageLabelParams): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().manageLabel(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

export async function handleManageWorkspaceLabelAssignment(args: ManageLabelAssignmentParams): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    await getGmailService().manageLabelAssignment(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: `Successfully ${args.action === 'add' ? 'added' : 'removed'} labels for message ${args.messageId}`
        }, null, 2)
      }]
    };
  });
}

export async function handleManageWorkspaceLabelFilter(args: ManageLabelFilterParams): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().manageLabelFilter(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}
