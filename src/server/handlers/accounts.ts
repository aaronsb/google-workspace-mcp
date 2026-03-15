import { listAccounts, removeAccount, authenticateAndAddAccount } from '../../accounts/registry.js';
import { nextSteps } from '../formatting/next-steps.js';
import type { HandlerResponse } from '../handler.js';

export async function handleAccounts(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;

  switch (operation) {
    case 'list': {
      const accounts = await listAccounts();
      if (accounts.length === 0) {
        return {
          text: 'No accounts configured.' + nextSteps('accounts', 'list_empty'),
          refs: { count: 0 },
        };
      }
      const lines = accounts.map((a: any) => {
        const cred = a.hasCredential ? '[x]' : '[ ]';
        const desc = a.description ? ` — ${a.description}` : '';
        return `${cred} ${a.email} (${a.category})${desc}`;
      });
      return {
        text: `## Accounts (${accounts.length})\n\n${lines.join('\n')}` +
          nextSteps('accounts', 'list'),
        refs: {
          count: accounts.length,
          accounts: accounts.map((a: any) => a.email),
          email: accounts[0]?.email,
        },
      };
    }

    case 'authenticate': {
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
        clientId, clientSecret,
        category as 'personal' | 'work' | 'other',
        description,
      );
      const statusText = result.status === 'success'
        ? `Account authenticated: **${result.account}**`
        : `Authentication failed: ${result.error}`;
      return {
        text: statusText + nextSteps('accounts', 'authenticate'),
        refs: { status: result.status, account: result.account, email: result.account },
      };
    }

    case 'remove': {
      const email = params.email as string;
      if (!email) throw new Error('email is required for remove');
      await removeAccount(email);
      return {
        text: `Account removed: ${email}` + nextSteps('accounts', 'remove'),
        refs: { status: 'removed', email },
      };
    }

    default:
      throw new Error(`Unknown accounts operation: ${operation}`);
  }
}
