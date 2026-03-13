import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Resolve gws binary: project node_modules/.bin first, then PATH
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_GWS = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', 'gws');
const GWS_BIN = PROJECT_GWS;
const DEFAULT_TIMEOUT = 30_000;

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

  return new Promise((resolve, reject) => {
    const proc = spawn(GWS_BIN, fullArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new GwsError('gws command timed out', GwsExitCode.InternalError, 'timeout', stderr));
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new GwsError(
        `Failed to spawn gws: ${err.message}`,
        GwsExitCode.InternalError,
        'spawn_error',
        stderr,
      ));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 1;
      const filteredStderr = filterStderr(stderr);

      if (exitCode !== GwsExitCode.Success) {
        reject(parseGwsError(exitCode, stdout, filteredStderr));
        return;
      }

      // Parse JSON output
      let data: unknown;
      if (format === 'json' && stdout.trim()) {
        try {
          data = JSON.parse(stdout);
        } catch {
          reject(new GwsError(
            'Failed to parse gws JSON output',
            GwsExitCode.InternalError,
            'parse_error',
            stdout,
          ));
          return;
        }
      } else {
        data = stdout;
      }

      resolve({ success: true, data, stderr: filteredStderr });
    });
  });
}

export async function gwsVersion(): Promise<string> {
  const result = await execute(['--version'], { format: 'json' });
  return String(result.data).trim();
}
