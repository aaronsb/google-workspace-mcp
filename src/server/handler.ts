import { execute } from '../executor/gws.js';
import { GwsError } from '../executor/errors.js';
import { listAccounts, removeAccount, authenticateAndAddAccount } from '../accounts/registry.js';
import type { ToolDefinition } from './tools.js';

export async function handleToolCall(
  tool: ToolDefinition,
  params: Record<string, unknown>,
): Promise<unknown> {
  // Account management tools are handled directly
  switch (tool.name) {
    case 'list_accounts':
      return handleListAccounts();
    case 'authenticate_account':
      return handleAuthenticateAccount(params);
    case 'remove_account':
      return handleRemoveAccount(params);
  }

  // All other tools go through the gws executor
  if (tool.requiresAccount) {
    const email = params.email as string | undefined;
    if (!email) {
      throw new Error('email is required for this tool. Use list_accounts to see available accounts.');
    }
    const gwsArgs = tool.toGwsArgs(params);
    const result = await execute(gwsArgs, { account: email });
    return result.data;
  }

  // Non-account tools without requiresAccount (shouldn't happen but handle gracefully)
  const gwsArgs = tool.toGwsArgs(params);
  const result = await execute(gwsArgs);
  return result.data;
}

async function handleListAccounts(): Promise<unknown> {
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    return {
      accounts: [],
      message: 'No accounts configured. Use authenticate_account to add one.',
    };
  }
  return { accounts };
}

async function handleAuthenticateAccount(params: Record<string, unknown>): Promise<unknown> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required. ' +
      'Create OAuth credentials at https://console.cloud.google.com/apis/credentials',
    );
  }

  const category = (params.category as string) || 'personal';
  const description = params.description as string | undefined;

  const result = await authenticateAndAddAccount(
    clientId,
    clientSecret,
    category as 'personal' | 'work' | 'other',
    description,
  );

  return result;
}

async function handleRemoveAccount(params: Record<string, unknown>): Promise<unknown> {
  const email = params.email as string;
  if (!email) throw new Error('email is required');

  await removeAccount(email);
  return { status: 'removed', email };
}
