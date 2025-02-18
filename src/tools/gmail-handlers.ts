import { getAccountManager } from '../modules/accounts/index.js';
import { getGmailService } from '../modules/gmail/index.js';
import { McpToolResponse, GmailSearchParams } from './types.js';

export async function handleSearchWorkspaceEmails(args: any): Promise<McpToolResponse> {
  const accountManager = getAccountManager();
  
  return await accountManager.withTokenRenewal(args.email, async () => {
    const params: GmailSearchParams = {
      email: args.email,
      search: args.search || {},
      options: {
        maxResults: args.maxResults
      }
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

export async function handleSendWorkspaceEmail(args: any): Promise<McpToolResponse> {
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

export async function handleGetWorkspaceGmailSettings(args: { email: string }): Promise<McpToolResponse> {
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

export async function handleCreateWorkspaceDraft(args: any): Promise<McpToolResponse> {
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

export async function handleGetWorkspaceDrafts(args: any): Promise<McpToolResponse> {
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

export async function handleSendWorkspaceDraft(args: any): Promise<McpToolResponse> {
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
export async function handleGetWorkspaceLabels(args: { email: string }): Promise<McpToolResponse> {
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

export async function handleCreateWorkspaceLabel(args: any): Promise<McpToolResponse> {
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

export async function handleUpdateWorkspaceLabel(args: any): Promise<McpToolResponse> {
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

export async function handleDeleteWorkspaceLabel(args: any): Promise<McpToolResponse> {
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

export async function handleModifyWorkspaceMessageLabels(args: any): Promise<McpToolResponse> {
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
