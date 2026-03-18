import { spawn, execFile } from 'node:child_process';
import { platform } from 'node:os';
import { execute, resolveGwsBinary, resolvePackageBinDir } from '../executor/gws.js';
import { exportAndSaveCredential, readCredential, hasCredential } from './credentials.js';

export interface AuthResult {
  status: 'success' | 'error';
  account?: string;
  credentialPath?: string;
  error?: string;
}

export interface AccountStatus {
  email: string;
  tokenValid: boolean;
  scopes: string[];
  scopeCount: number;
  hasRefreshToken: boolean;
}

/**
 * Check account status by reading our credential file and validating
 * the token via a lightweight Gmail API call.
 *
 * Note: `gws auth status` is single-account (keyring-based) and ignores
 * GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE. We bypass it entirely and
 * validate against our own per-account credential files.
 */
export async function checkAccountStatus(email: string): Promise<AccountStatus> {
  const hasCred = await hasCredential(email);
  if (!hasCred) {
    return {
      email,
      tokenValid: false,
      scopes: [],
      scopeCount: 0,
      hasRefreshToken: false,
    };
  }

  const cred = await readCredential(email);
  const hasRefreshToken = Boolean(cred.refresh_token);

  // Validate the token with a lightweight API call using this account's credential
  let tokenValid = false;
  try {
    await execute(
      ['gmail', 'users', 'getProfile', '--params', JSON.stringify({ userId: 'me' })],
      { account: email },
    );
    tokenValid = true;
  } catch {
    tokenValid = false;
  }

  // Get scopes from gws auth status. These are the scopes granted to the
  // OAuth app, not per-account — gws is single-account so we can't get
  // per-account scopes. But they're useful for showing what services are enabled.
  let scopes: string[] = [];
  if (tokenValid) {
    try {
      const statusResult = await execute(['auth', 'status']);
      const statusData = statusResult.data as Record<string, unknown>;
      scopes = Array.isArray(statusData.scopes) ? statusData.scopes as string[] : [];
    } catch {
      // Non-critical — scopes are informational
    }
  }

  return {
    email,
    tokenValid,
    scopes,
    scopeCount: scopes.length,
    hasRefreshToken,
  };
}

export async function authenticateAccount(
  clientId: string,
  clientSecret: string,
): Promise<AuthResult> {
  return runAuthLogin(clientId, clientSecret, ['auth', 'login']);
}

export async function reauthWithServices(
  clientId: string,
  clientSecret: string,
  services: string,
): Promise<AuthResult> {
  return runAuthLogin(clientId, clientSecret, ['auth', 'login', '-s', services]);
}

// --- Internal ---

function runAuthLogin(
  clientId: string,
  clientSecret: string,
  args: string[],
): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      GOOGLE_WORKSPACE_CLI_CLIENT_ID: clientId,
      GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: clientSecret,
    };

    const gwsBinary = resolveGwsBinary();
    env.PATH = `${resolvePackageBinDir()}:${env.PATH || ''}`;

    const proc = spawn(gwsBinary, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/accounts\.google\.com\S+/);
      if (match) openBrowser(match[0]);
    });

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn gws auth login: ${err.message}`));
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        resolve({ status: 'error', error: `gws auth login exited with code ${code}` });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        const email = result.account as string;
        if (!email) {
          resolve({ status: 'error', error: 'No account email in gws auth login response' });
          return;
        }
        const credPath = await exportAndSaveCredential(email);
        resolve({ status: 'success', account: email, credentialPath: credPath });
      } catch (err) {
        resolve({ status: 'error', error: `Failed to process auth result: ${(err as Error).message}` });
      }
    });
  });
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open'
            : platform() === 'win32' ? 'start'
            : 'xdg-open';
  execFile(cmd, [url], (err) => {
    if (err) process.stderr.write(`Failed to open browser: ${err.message}\n`);
  });
}
