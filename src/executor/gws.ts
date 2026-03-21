import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { GwsExitCode, GwsError, parseGwsError } from './errors.js';
import { getAccessToken } from '../accounts/token-service.js';

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

const DEFAULT_TIMEOUT = 120_000; // Hard ceiling (2min) — process dies after this regardless
const STALL_TIMEOUT = 30_000;   // Kill if no stdout/stderr activity for 30s
                                // (generous: gws may do OAuth refresh, API pagination, cold start)

const IS_WINDOWS = process.platform === 'win32';
const GWS_BINARY_NAME = IS_WINDOWS ? 'gws.exe' : 'gws';

/**
 * Resolve gws binary location.
 *
 * Priority:
 * 1. GWS_BINARY_PATH env var (set by mcpb manifest for bundled binary)
 *    - If path is a directory, appends platform-appropriate binary name
 *    - If path is a file, uses it directly
 * 2. node_modules/.bin/gws (npm dependency)
 */
export function resolveGwsBinary(): string {
  const envPath = process.env.GWS_BINARY_PATH;
  if (envPath) {
    // Support both direct binary path and directory path
    if (envPath.endsWith('.exe') || envPath.endsWith('/gws') || envPath.endsWith('\\gws')) {
      return envPath;
    }
    return path.join(envPath, GWS_BINARY_NAME);
  }
  return path.join(process.cwd(), 'node_modules', '.bin', GWS_BINARY_NAME);
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
    const accessToken = await getAccessToken(account);
    env.GOOGLE_WORKSPACE_CLI_TOKEN = accessToken;
  }

  const fullArgs = [...args, '--format', format];

  // Resolve gws binary — bundled (mcpb) or npm dependency
  const gwsBinary = resolveGwsBinary();
  process.stderr.write(`[gws-mcp] exec: ${gwsBinary} ${fullArgs.join(' ')}\n`);
  if (account) {
    process.stderr.write(`[gws-mcp] token: [access token for ${account}]\n`);
  }

  // Still prepend bin dir to PATH for non-bundled case
  env.PATH = `${resolvePackageBinDir()}:${env.PATH || ''}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const proc = spawn(gwsBinary, fullArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    // Activity-based stall detection: kill if process goes silent
    let lastActivity = Date.now();
    const resetStall = () => { lastActivity = Date.now(); };

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); resetStall(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); resetStall(); });

    const killProc = (reason: string) => {
      process.stderr.write(`[gws-mcp] ${reason}\n`);
      proc.kill('SIGTERM');
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 3000);
      killTimer.unref();
    };

    // Stall detector — checks periodically if the process has gone silent
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > STALL_TIMEOUT) {
        clearInterval(stallCheck);
        killProc(`stall: no output for ${STALL_TIMEOUT / 1000}s, killing gws`);
        settle(() => reject(new GwsError(
          `gws stalled (no output for ${STALL_TIMEOUT / 1000}s)`,
          GwsExitCode.InternalError, 'stall', stderr,
        )));
      }
    }, 5000);
    stallCheck.unref();

    // Hard timeout — absolute ceiling regardless of activity
    const timer = setTimeout(() => {
      clearInterval(stallCheck);
      killProc(`hard timeout: killing gws after ${timeout / 1000}s`);
      settle(() => reject(new GwsError('gws command timed out', GwsExitCode.InternalError, 'timeout', stderr)));
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      process.stderr.write(`[gws-mcp] spawn error: ${err.message}\n`);
      settle(() => reject(new GwsError(
        `Failed to spawn gws: ${err.message}`,
        GwsExitCode.InternalError,
        'spawn_error',
        stderr,
      )));
    });

    // Ensure child process is cleaned up if the parent exits
    const cleanup = () => { try { proc.kill('SIGTERM'); } catch { /* already dead */ } };
    process.once('exit', cleanup);

    proc.on('close', (code) => {
      clearInterval(stallCheck);
      process.removeListener('exit', cleanup);
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
