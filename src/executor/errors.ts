export enum GwsExitCode {
  Success = 0,
  ApiError = 1,
  AuthError = 2,
  ValidationError = 3,
  DiscoveryError = 4,
  InternalError = 5,
}

export class GwsError extends Error {
  constructor(
    message: string,
    public readonly exitCode: GwsExitCode,
    public readonly reason?: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'GwsError';
  }
}

export function parseGwsError(exitCode: number, stdout: string, stderr: string): GwsError {
  // Try to extract structured error from stdout
  try {
    const parsed = JSON.parse(stdout);
    if (parsed?.error) {
      return new GwsError(
        parsed.error.message || 'Unknown gws error',
        exitCode as GwsExitCode,
        parsed.error.reason,
        stderr,
      );
    }
  } catch {
    // stdout wasn't JSON — fall through
  }

  const label = GwsExitCode[exitCode as GwsExitCode] ?? 'Unknown';
  const message = stderr.trim() || `gws exited with code ${exitCode} (${label})`;
  return new GwsError(message, exitCode as GwsExitCode, undefined, stderr);
}
