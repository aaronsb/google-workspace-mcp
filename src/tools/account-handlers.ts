import { getAccountManager } from '../modules/accounts/index.js';
import { McpToolResponse, BaseToolArguments } from './types.js';

/**
 * Lists all configured Google Workspace accounts and their authentication status
 * @returns List of accounts with their configuration and auth status
 * @throws {McpError} If account manager fails to retrieve accounts
 */
export async function handleListWorkspaceAccounts(): Promise<McpToolResponse> {
  const accounts = await getAccountManager().listAccounts();
  
  // Filter out sensitive token data before returning to AI
  const sanitizedAccounts = accounts.map(account => ({
    ...account,
    auth_status: account.auth_status ? {
      valid: account.auth_status.valid,
      status: account.auth_status.status,
      reason: account.auth_status.reason,
      authUrl: account.auth_status.authUrl
    } : undefined
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(sanitizedAccounts, null, 2)
    }]
  };
}

export interface AuthenticateAccountArgs extends BaseToolArguments {
  category?: string;
  description?: string;
  auth_code?: string;
}

/**
 * Authenticates a Google Workspace account through OAuth2
 * @param args.email - Email address to authenticate
 * @param args.category - Optional account category (e.g., 'work', 'personal')
 * @param args.description - Optional account description
 * @param args.auth_code - OAuth2 authorization code (required for completing auth)
 * @returns Auth URL if auth_code not provided, success message if auth completed
 * @throws {McpError} If validation fails or OAuth flow errors
 */
export async function handleAuthenticateWorkspaceAccount(args: AuthenticateAccountArgs): Promise<McpToolResponse> {
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

/**
 * Removes a Google Workspace account and its associated authentication tokens
 * @param args.email - Email address of the account to remove
 * @returns Success message if account removed
 * @throws {McpError} If account removal fails
 */
export async function handleRemoveWorkspaceAccount(args: BaseToolArguments): Promise<McpToolResponse> {
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
