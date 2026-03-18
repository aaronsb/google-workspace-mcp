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

/**
 * Resolve gws binary location.
 *
 * Priority:
 * 1. GWS_BINARY_PATH env var (set by mcpb manifest for bundled binary)
 * 2. node_modules/.bin/gws (npm dependency)
 */
export function resolveGwsBinary(): string {
  if (process.env.GWS_BINARY_PATH) {
    return process.env.GWS_BINARY_PATH;
  }
  return path.join(process.cwd(), 'node_modules', '.bin', 'gws');
}

// Kept for backward compatibility with tests
export function resolvePackageBinDir(): string {
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

  // Resolve gws binary — bundled (mcpb) or npm dependency
  const gwsBinary = resolveGwsBinary();

  // Still prepend bin dir to PATH for non-bundled case
  env.PATH = `${resolvePackageBinDir()}:${env.PATH || ''}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const proc = spawn(gwsBinary, fullArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });

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
