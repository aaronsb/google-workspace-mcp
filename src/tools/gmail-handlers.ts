import { getAccountManager } from '../modules/accounts/index.js';
import { getGmailService } from '../modules/gmail/index.js';
import {
  McpToolResponse,
  GmailSearchParams,
  BaseToolArguments,
  SendEmailArgs,
  CreateDraftArgs,
  ListDraftsArgs,
  SendDraftArgs,
  CreateLabelArgs,
  UpdateLabelArgs,
  DeleteLabelArgs,
  ModifyLabelsArgs
} from './types.js';

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
 * Create a new email draft
 * @param args - Same parameters as SendEmailArgs plus:
 * @param args.replyToMessageId - Optional message ID to reply to
 * @param args.threadId - Optional thread ID for the draft
 * @param args.references - Optional message IDs for email threading
 * @param args.inReplyTo - Optional message ID being replied to
 * @returns Draft ID and other draft metadata
 * @throws {McpError} If draft creation fails
 */
export async function handleCreateWorkspaceDraft(args: CreateDraftArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().createDraft(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}


/**
 * Get list of email drafts
 * @param args.email - Gmail account to get drafts from
 * @param args.maxResults - Maximum number of drafts to return
 * @param args.pageToken - Token for getting next page of results
 * @returns List of draft messages with metadata
 * @throws {McpError} If drafts retrieval fails
 */
export async function handleGetWorkspaceDrafts(args: ListDraftsArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().getDrafts(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}


/**
 * Send an existing draft
 * @param args.email - Gmail account containing the draft
 * @param args.draftId - ID of the draft to send
 * @returns Message ID and thread ID of sent email
 * @throws {McpError} If sending fails or draft not found
 */
export async function handleSendWorkspaceDraft(args: SendDraftArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().sendDraft(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}

// Label Management Handlers
export async function handleGetWorkspaceLabels(args: BaseToolArguments): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().getLabels({ email: args.email });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}


/**
 * Create a new Gmail label
 * @param args.email - Gmail account to create label in
 * @param args.name - Label name (use "/" for nesting, e.g. "Work/Projects")
 * @param args.messageListVisibility - Label visibility in message list
 * @param args.labelListVisibility - Label visibility in label list
 * @param args.color - Optional color settings (hex codes)
 * @returns Created label ID and full details
 * @throws {McpError} If label creation fails or name invalid
 */
export async function handleCreateWorkspaceLabel(args: CreateLabelArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().createLabel(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}


/**
 * Update an existing Gmail label
 * @param args - Same parameters as CreateLabelArgs plus:
 * @param args.labelId - ID of the label to update
 * @returns Updated label details
 * @throws {McpError} If update fails or label not found
 */
export async function handleUpdateWorkspaceLabel(args: UpdateLabelArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const result = await getGmailService().updateLabel(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}


/**
 * Delete a Gmail label
 * @param args.email - Gmail account containing the label
 * @param args.labelId - ID of the label to delete
 * @returns Success message
 * @throws {McpError} If deletion fails or label not found
 */
export async function handleDeleteWorkspaceLabel(args: DeleteLabelArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    await getGmailService().deleteLabel(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: `Successfully deleted label ${args.labelId}`
        }, null, 2)
      }]
    };
  });
}


/**
 * Add or remove labels from a Gmail message
 * @param args.email - Gmail account containing the message
 * @param args.messageId - ID of the message to modify
 * @param args.addLabelIds - Label IDs to add to the message
 * @param args.removeLabelIds - Label IDs to remove from the message
 * @returns Success message
 * @throws {McpError} If modification fails or message not found
 */
export async function handleModifyWorkspaceMessageLabels(args: ModifyLabelsArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    await getGmailService().modifyMessageLabels(args);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: `Successfully modified labels for message ${args.messageId}`
        }, null, 2)
      }]
    };
  });
}
