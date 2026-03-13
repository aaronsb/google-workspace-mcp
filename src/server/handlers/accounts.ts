import { listAccounts, removeAccount, authenticateAndAddAccount } from '../../accounts/registry.js';
import { nextSteps } from '../formatting/next-steps.js';

export async function handleAccounts(params: Record<string, unknown>): Promise<unknown> {
  const operation = params.operation as string;

  switch (operation) {
    case 'list': {
      const accounts = await listAccounts();
      if (accounts.length === 0) {
        return {
          accounts: [],
          message: 'No accounts configured.',
          ...nextSteps('accounts', 'list_empty'),
        };
      }
      return {
        accounts,
        ...nextSteps('accounts', 'list'),
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
      return { ...result, ...nextSteps('accounts', 'authenticate') };
    }

    case 'remove': {
      const email = params.email as string;
      if (!email) throw new Error('email is required for remove');
      await removeAccount(email);
      return { status: 'removed', email, ...nextSteps('accounts', 'remove') };
    }

    default:
      throw new Error(`Unknown accounts operation: ${operation}`);
  }
}
