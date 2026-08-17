import { listAccounts, removeAccount, authenticateAndAddAccount, type Account } from '../../accounts/registry.js';
import { checkAccountStatus, reauthWithServices } from '../../accounts/auth.js';
import { scopesForServices, ALL_SERVICES, type AccessLevel } from '../../accounts/oauth.js';
import { getAccessToken, invalidateToken } from '../../accounts/token-service.js';
import { nextSteps } from '../formatting/next-steps.js';
import { getActivePolicies } from '../../factory/safety.js';
import { manifest } from '../../factory/registry.js';
import { checkWorkspaceStatus } from '../../executor/workspace.js';
import { VERSION } from '../../version.js';
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

function formatStatus(status: { email: string; tokenValid: boolean; scopes: string[]; scopeCount: number; hasRefreshToken: boolean; access: AccessLevel; stillAllowWrites?: string[] }): { text: string; refs: Record<string, unknown> } {
  const valid = status.tokenValid ? '[x] Token valid' : '[ ] Token invalid';
  const refresh = status.hasRefreshToken ? '[x] Has refresh token' : '[ ] No refresh token';
  // Say what this account can DO, not just which scope strings it holds — the scope list
  // below is accurate and takes a Google reference to read.
  //
  // `access` is the level ASKED FOR. An account confirmed through confirmWriteAccess is
  // stored as 'read' while holding write scopes for the services that had no read-only
  // option, so the declared level alone would assert something false. The services that
  // stayed writable are stored with it and named here.
  const stillWritable = status.stillAllowWrites ?? [];
  const level = status.access === 'read'
    ? (stillWritable.length
      ? `[~] Read-only, except: **${stillWritable.join(', ')}** — those have no read-only option and can still be changed`
      : '[x] Read-only — this account cannot send, edit or delete')
    : '[x] Full access — this account can create, edit and delete';
  const scopeList = status.scopes.length > 0
    ? status.scopes.map(s => `- ${s.replace('https://www.googleapis.com/auth/', '')}`).join('\n')
    : '(no scopes)';

  return {
    text: [
      `## Account Status: ${status.email}`,
      '',
      valid,
      refresh,
      level,
      `**Scopes (${status.scopeCount}):**`,
      scopeList,
    ].join('\n'),
    refs: {
      email: status.email,
      tokenValid: status.tokenValid,
      scopeCount: status.scopeCount,
      scopes: status.scopes,
      access: status.access,
      stillAllowWrites: status.stillAllowWrites ?? [],
    },
  };
}

/**
 * Read the requested access level, rejecting anything that is not one of the two.
 *
 * This was a cast. The server registers tools through the low-level
 * `setRequestHandler(CallToolRequestSchema, …)` path, which does NOT validate arguments
 * against `inputSchema` — the enum in tools.ts is advertisement, not enforcement. So
 * `access: 'read-only'` (a plausible thing to send, since the description says "read-only"
 * three times) fell through `|| 'readwrite'` unchanged, requested FULL scopes, produced an
 * empty stillAllowWrites, skipped the confirmation gate entirely, and wrote a credential
 * claiming read. Asking for read and silently receiving write is the one thing this
 * feature exists to prevent.
 */
function requestedAccess(params: Record<string, unknown>): AccessLevel {
  const raw = params.access ?? 'readwrite';
  if (raw !== 'read' && raw !== 'readwrite') {
    throw new Error(
      `access must be 'read' or 'readwrite', got '${String(raw)}'. ` +
      `Use 'read' for an account that should only look things up.`,
    );
  }
  return raw;
}

/**
 * Stop before the browser opens when read-only access was asked for and some services
 * cannot provide it.
 *
 * Reporting this afterwards is too late: by then the token exists carrying write
 * permissions, and taking it back means a manual trip to Google's permissions page. So
 * the first call returns this instead of authorizing anything, and the caller either
 * confirms or drops those services from the list.
 *
 * Returns null when there is nothing to warn about.
 */
function writeAccessWarning(
  stillAllowWrites: string[],
  params: Record<string, unknown>,
  retry: string,
  /**
   * `authenticate` has no `services` parameter — it always requests every service — so
   * telling its caller to drop one from `services` is advice they cannot take. That path
   * gets pointed at `scopes`, which does take a list.
   */
  canNarrowServices: boolean,
): HandlerResponse | null {
  if (stillAllowWrites.length === 0) return null;
  if (params.confirmWriteAccess === true) return null;

  const names = stillAllowWrites.join(', ');
  return {
    text:
      `Read-only access was requested, but Google has no read-only permission for: **${names}**.\n\n` +
      `Authorizing anyway would let this account change ${stillAllowWrites.length === 1 ? 'that service' : 'those services'}, ` +
      `not just read from ${stillAllowWrites.length === 1 ? 'it' : 'them'}. Nothing has been authorized yet.\n\n` +
      `Either:\n` +
      (canNarrowServices
        ? `- Leave ${names} out of \`services\` and re-run, to keep this account read-only.\n`
        : `- Authorize with \`operation: 'scopes'\` instead, listing only the services you want read-only.\n`) +
      `- Or re-run with \`confirmWriteAccess: true\` to accept it: ${retry}\n`,
    refs: { status: 'needs-confirmation', stillAllowWrites },
  };
}

export async function handleAccounts(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;

  switch (operation) {
    case 'list': {
      process.stderr.write(`[google-workspace-mcp] accounts.list: reading accounts file\n`);
      const accounts = await listAccounts() as EnrichedAccount[];
      process.stderr.write(`[google-workspace-mcp] accounts.list: found ${accounts.length} accounts\n`);
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
      const access = requestedAccess(params);

      // Check what this access level would actually grant BEFORE opening a browser.
      const warning = writeAccessWarning(
        scopesForServices(ALL_SERVICES, access).stillAllowWrites,
        params,
        `manage_accounts {"operation":"authenticate","access":"read","confirmWriteAccess":true}`,
        false,
      );
      if (warning) return warning;

      const result = await authenticateAndAddAccount(
        clientId, clientSecret,
        category as 'personal' | 'work' | 'other',
        description,
        access,
      );
      const grantNote = result.stillAllowWrites?.length
        ? `\n\n> Read-only was requested. ${result.stillAllowWrites.join(', ')} had no read-only option and can still be changed by this account.`
        : '';
      const statusText = result.status === 'success'
        ? `Account authenticated: **${result.account}** (${access === 'read' ? 'read-only' : 'full access'})${grantNote}`
        : `Authentication failed: ${result.error}`;
      return {
        text: statusText + nextSteps('accounts', 'authenticate'),
        refs: {
          status: result.status, account: result.account, email: result.account,
          access, stillAllowWrites: result.stillAllowWrites ?? [],
        },
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
      const access = requestedAccess(params);

      // Same gate as authenticate — say it before the browser opens, not after.
      const warning = writeAccessWarning(
        scopesForServices(services, access).stillAllowWrites,
        params,
        `manage_accounts {"operation":"scopes","email":"${email}","services":"${services}","access":"read","confirmWriteAccess":true}`,
        true,
      );
      if (warning) return warning;

      const result = await reauthWithServices(clientId, clientSecret, services, access);
      const grantNote = result.stillAllowWrites?.length
        ? `\n\n> Read-only was requested. ${result.stillAllowWrites.join(', ')} had no read-only option and can still be changed by this account.`
        : '';
      const statusText = result.status === 'success'
        ? `Scopes updated for **${result.account}**: ${services} (${access === 'read' ? 'read-only' : 'full access'})${grantNote}`
        : `Scope update failed: ${result.error}`;
      return {
        text: statusText + nextSteps('accounts', 'scopes', { email }),
        refs: {
          status: result.status, email: result.account, services,
          access, stillAllowWrites: result.stillAllowWrites ?? [],
        },
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

      // Version
      parts.push(`## Server Version\n\n**@aaronsb/google-workspace-mcp** v${VERSION}\n`);

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
          version: VERSION,
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
