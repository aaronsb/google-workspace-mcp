import { spawn, execFile } from 'node:child_process';
import { platform } from 'node:os';
import { execute } from '../executor/gws.js';
import { credentialPath } from '../executor/paths.js';
import { exportAndSaveCredential } from './credentials.js';

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

export async function checkAccountStatus(email: string): Promise<AccountStatus> {
  const result = await execute(['auth', 'status'], { account: email });
  const data = result.data as Record<string, unknown>;
  return {
    email: (data.user as string) ?? email,
    tokenValid: Boolean(data.token_valid),
    scopes: Array.isArray(data.scopes) ? data.scopes as string[] : [],
    scopeCount: Number(data.scope_count ?? 0),
    hasRefreshToken: Boolean(data.has_refresh_token),
  };
}

export async function reauthWithServices(
  clientId: string,
  clientSecret: string,
  services: string,
): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      GOOGLE_WORKSPACE_CLI_CLIENT_ID: clientId,
      GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: clientSecret,
    };

    const proc = spawn('gws', ['auth', 'login', '-s', services], {
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
  // Use execFile to avoid shell interpretation of the URL
  execFile(cmd, [url], (err) => {
    if (err) process.stderr.write(`Failed to open browser: ${err.message}\n`);
  });
}

export async function authenticateAccount(
  clientId: string,
  clientSecret: string,
): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      GOOGLE_WORKSPACE_CLI_CLIENT_ID: clientId,
      GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: clientSecret,
    };

    const proc = spawn('gws', ['auth', 'login'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';

    // Capture auth URL from stderr, open in default browser
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/accounts\.google\.com\S+/);
      if (match) {
        openBrowser(match[0]);
      }
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

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

        // Export credential from gws's encrypted store into our per-account storage
        const credPath = await exportAndSaveCredential(email);

        resolve({
          status: 'success',
          account: email,
          credentialPath: credPath,
        });
      } catch (err) {
        resolve({
          status: 'error',
          error: `Failed to process auth result: ${(err as Error).message}`,
        });
      }
    });
  });
}
