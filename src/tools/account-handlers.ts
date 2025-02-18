import { getAccountManager } from '../modules/accounts/index.js';
import { McpToolResponse } from './types.js';

export async function handleListWorkspaceAccounts(): Promise<McpToolResponse> {
  const accounts = await getAccountManager().listAccounts();
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(accounts, null, 2)
    }]
  };
}

export async function handleAuthenticateWorkspaceAccount(args: any): Promise<McpToolResponse> {
  const accountManager = getAccountManager();

  // Validate/create account
  await accountManager.validateAccount(args.email, args.category, args.description);

  // If auth code is provided, complete the OAuth flow
  if (args.auth_code) {
    const tokenData = await accountManager.getTokenFromCode(args.auth_code);
    await accountManager.saveToken(args.email, tokenData);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: 'Authentication successful! Token saved. Please retry your request.'
        }, null, 2)
      }]
    };
  }

  // Start OAuth flow
  const authUrl = await accountManager.generateAuthUrl();
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'auth_required',
        auth_url: authUrl,
        message: 'Please complete authentication:',
        instructions: [
          '0. Share a clickable authorization URL link below with the user to authenticate',
          '1. Instruct the user to click the authorization URL to open Google sign-in',
          '2. Sign in with your Google account',
          '3. Allow the requested permissions',
          '4. Copy the authorization code shown',
          '5. Run this request again with the auth_code parameter set to the code you copied'
        ].join('\n')
      }, null, 2)
    }]
  };
}

export async function handleRemoveWorkspaceAccount(args: { email: string }): Promise<McpToolResponse> {
  await getAccountManager().removeAccount(args.email);
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'success',
        message: `Successfully removed account ${args.email} and deleted associated tokens`
      }, null, 2)
    }]
  };
}
