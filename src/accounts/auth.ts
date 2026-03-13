import { spawn, exec } from 'node:child_process';
import { platform } from 'node:os';
import { exportAndSaveCredential } from './credentials.js';

export interface AuthResult {
  status: 'success' | 'error';
  account?: string;
  credentialPath?: string;
  error?: string;
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open'
            : platform() === 'win32' ? 'start'
            : 'xdg-open';
  exec(`${cmd} ${JSON.stringify(url)}`);
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
