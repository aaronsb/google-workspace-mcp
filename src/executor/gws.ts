import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { credentialPath } from './paths.js';
import { GwsExitCode, GwsError, parseGwsError } from './errors.js';

export interface GwsResult {
  success: boolean;
  data: unknown;
  stderr: string;
}

export interface GwsOptions {
  account?: string;
  timeout?: number;
  format?: 'json' | 'table' | 'yaml' | 'csv';
}

const DEFAULT_TIMEOUT = 30_000;

// Resolve gws binary from node_modules relative to this package.
// Walks up from this file's compiled location to find the project root.
// Exported for testing.
export function resolvePackageBinDir(): string {
  // In production (ESM), __dirname isn't available but we can derive from
  // the build output structure: build/executor/gws.js → ../../node_modules/.bin
  // In development, process.cwd() is the project root.
  return path.join(process.cwd(), 'node_modules', '.bin');
}

// Stderr lines that are diagnostic noise, not errors
const STDERR_NOISE = [
  /^Using keyring backend:/,
];

function filterStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter(line => !STDERR_NOISE.some(pattern => pattern.test(line)))
    .join('\n')
    .trim();
}

export async function execute(args: string[], options: GwsOptions = {}): Promise<GwsResult> {
  const { account, timeout = DEFAULT_TIMEOUT, format = 'json' } = options;

  const env: Record<string, string> = { ...process.env as Record<string, string> };

  if (account) {
    env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = credentialPath(account);
  }

  const fullArgs = [...args, '--format', format];

  // Prepend package-local bin dir to PATH
  env.PATH = `${resolvePackageBinDir()}:${env.PATH || ''}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const proc = spawn('gws', fullArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      settle(() => reject(new GwsError('gws command timed out', GwsExitCode.InternalError, 'timeout', stderr)));
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new GwsError(
        `Failed to spawn gws: ${err.message}`,
        GwsExitCode.InternalError,
        'spawn_error',
        stderr,
      )));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      const filteredStderr = filterStderr(stderr);

      if (exitCode !== GwsExitCode.Success) {
        settle(() => reject(parseGwsError(exitCode, stdout, filteredStderr)));
        return;
      }

      // Parse JSON output
      let data: unknown;
      if (format === 'json' && stdout.trim()) {
        try {
          data = JSON.parse(stdout);
        } catch {
          settle(() => reject(new GwsError(
            'Failed to parse gws JSON output',
            GwsExitCode.InternalError,
            'parse_error',
            stdout,
          )));
          return;
        }
      } else {
        data = stdout;
      }

      settle(() => resolve({ success: true, data, stderr: filteredStderr }));
    });
  });
}

export async function gwsVersion(): Promise<string> {
  // --version outputs plain text, not JSON
  const result = await execute(['--version'], { format: 'table' });
  return String(result.data).trim();
}
