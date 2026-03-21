import { listAccounts, removeAccount, authenticateAndAddAccount, type Account } from '../../accounts/registry.js';
import { checkAccountStatus, reauthWithServices } from '../../accounts/auth.js';
import { getAccessToken, invalidateToken } from '../../accounts/token-service.js';
import { nextSteps } from '../formatting/next-steps.js';
import { getActivePolicies } from '../../factory/safety.js';
import { manifest } from '../../factory/registry.js';
import { checkWorkspaceStatus } from '../../executor/workspace.js';
import type { HandlerResponse } from '../handler.js';

interface EnrichedAccount extends Account {
  hasCredential: boolean;
}

function formatAccountList(accounts: EnrichedAccount[]): { text: string; refs: Record<string, unknown> } {
  const lines = accounts.map(a => {
    const cred = a.hasCredential ? '[x]' : '[ ]';
    const desc = a.description ? ` — ${a.description}` : '';
    return `${cred} ${a.email} (${a.category})${desc}`;
  });

  return {
    text: `## Accounts (${accounts.length})\n\n${lines.join('\n')}`,
    refs: {
      count: accounts.length,
      accounts: accounts.map(a => a.email),
      email: accounts[0]?.email,
    },
  };
}

function formatStatus(status: { email: string; tokenValid: boolean; scopes: string[]; scopeCount: number; hasRefreshToken: boolean }): { text: string; refs: Record<string, unknown> } {
  const valid = status.tokenValid ? '[x] Token valid' : '[ ] Token invalid';
  const refresh = status.hasRefreshToken ? '[x] Has refresh token' : '[ ] No refresh token';
  const scopeList = status.scopes.length > 0
    ? status.scopes.map(s => `- ${s.replace('https://www.googleapis.com/auth/', '')}`).join('\n')
    : '(no scopes)';

  return {
    text: [
      `## Account Status: ${status.email}`,
      '',
      valid,
      refresh,
      `**Scopes (${status.scopeCount}):**`,
      scopeList,
    ].join('\n'),
    refs: {
      email: status.email,
      tokenValid: status.tokenValid,
      scopeCount: status.scopeCount,
      scopes: status.scopes,
    },
  };
}

export async function handleAccounts(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;

  switch (operation) {
    case 'list': {
      process.stderr.write(`[gws-mcp] accounts.list: reading accounts file\n`);
      const accounts = await listAccounts() as EnrichedAccount[];
      process.stderr.write(`[gws-mcp] accounts.list: found ${accounts.length} accounts\n`);
      if (accounts.length === 0) {
        return {
          text: 'No accounts configured.' + nextSteps('accounts', 'list_empty'),
          refs: { count: 0 },
        };
      }
      const formatted = formatAccountList(accounts);
      return {
        text: formatted.text + nextSteps('accounts', 'list'),
        refs: formatted.refs,
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

    case 'status': {
      const email = params.email as string;
      if (!email) throw new Error('email is required for status');
      const status = await checkAccountStatus(email);
      const formatted = formatStatus(status);
      return {
        text: formatted.text + nextSteps('accounts', 'status', { email }),
        refs: formatted.refs,
      };
    }

    case 'refresh': {
      const email = params.email as string;
      if (!email) throw new Error('email is required for refresh');
      invalidateToken(email);
      await getAccessToken(email);
      return {
        text: `Token refreshed for ${email}` + nextSteps('accounts', 'refresh', { email }),
        refs: { status: 'refreshed', email },
      };
    }

    case 'scopes': {
      const email = params.email as string;
      const services = params.services as string;
      if (!email) throw new Error('email is required for scopes');
      if (!services) throw new Error('services is required for scopes (comma-separated: gmail,drive,calendar,sheets,etc.)');
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required');
      }
      const result = await reauthWithServices(clientId, clientSecret, services);
      const statusText = result.status === 'success'
        ? `Scopes updated for **${result.account}** with services: ${services}`
        : `Scope update failed: ${result.error}`;
      return {
        text: statusText + nextSteps('accounts', 'scopes', { email }),
        refs: { status: result.status, email: result.account, services },
      };
    }

    case 'capabilities': {
      const policies = getActivePolicies();
      const services = Object.entries(manifest.services).map(([name, def]) => ({
        service: name,
        tool: def.tool_name,
        operations: Object.keys(def.operations),
      }));
      const workspace = checkWorkspaceStatus();

      const parts: string[] = [];

      // Services
      const totalOps = services.reduce((sum, s) => sum + s.operations.length, 0);
      parts.push(`## Services (${services.length} services, ${totalOps} operations)\n`);
      for (const s of services) {
        parts.push(`**${s.tool}** (${s.operations.length}): ${s.operations.join(', ')}`);
      }

      // Safety policies
      parts.push('');
      if (policies.length > 0) {
        parts.push(`## Safety Policies (${policies.length} active)\n`);
        for (const p of policies) {
          parts.push(`- **${p.name}**: ${p.description}`);
        }
      } else {
        parts.push('## Safety Policies\n\nNo safety policies active — all operations are allowed.');
      }

      // Workspace
      parts.push('');
      parts.push('## Workspace Directory\n');
      parts.push(`**Path:** ${workspace.path}`);
      parts.push(`**Status:** ${workspace.valid ? 'valid' : 'invalid — ' + workspace.warning}`);

      return {
        text: parts.join('\n'),
        refs: {
          totalServices: services.length,
          totalOperations: totalOps,
          activePolicies: policies.map(p => p.name),
          workspacePath: workspace.path,
          workspaceValid: workspace.valid,
        },
      };
    }

    default:
      throw new Error(`Unknown accounts operation: ${operation}`);
  }
}
