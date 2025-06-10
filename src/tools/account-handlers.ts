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
  step?: 'start' | 'complete';
}

/**
 * Authenticates a Google Workspace account through OAuth2
 * @param args.email - Email address to authenticate
 * @param args.category - Optional account category (e.g., 'work', 'personal')
 * @param args.description - Optional account description
 * @param args.auth_code - OAuth2 authorization code (optional for manual flow)
 * @param args.step - 'start' to begin auth flow, 'complete' to finish it
 * @returns Auth URL and instructions for completing authentication
 * @throws {McpError} If validation fails or OAuth flow errors
 */
export async function handleAuthenticateWorkspaceAccount(args: AuthenticateAccountArgs): Promise<McpToolResponse> {
  const accountManager = getAccountManager();

  // Validate/create account
  await accountManager.validateAccount(args.email, args.category, args.description);

  // If auth code is provided (manual fallback), complete the OAuth flow
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

  // Generate OAuth URL and provide instructions for manual code entry
  const authUrl = await accountManager.generateAuthUrl();
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        status: 'auth_required',
        auth_url: authUrl,
        message: 'Please complete Google OAuth authentication:',
        instructions: [
          '1. Click the authorization URL below to open Google sign-in in your browser',
          '2. Sign in with your Google account and allow the requested permissions',
          '3. After authorization, you will see a success page with your authorization code',
          '4. Copy the authorization code from the success page',
          '5. Call this tool again with the auth_code parameter: authenticate_workspace_account with auth_code="your_code_here"'
        ].join('\n'),
        note: 'The callback server is running on localhost:8080 and will display your authorization code for easy copying.'
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
