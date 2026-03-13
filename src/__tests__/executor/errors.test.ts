import { GwsError, GwsExitCode, parseGwsError } from '../../executor/errors.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

describe('GwsError', () => {
  it('maps auth errors to InvalidRequest MCP error', () => {
    const err = new GwsError('bad auth', GwsExitCode.AuthError);
    expect(err.toMcpErrorCode()).toBe(ErrorCode.InvalidRequest);
  });

  it('maps validation errors to InvalidParams MCP error', () => {
    const err = new GwsError('bad args', GwsExitCode.ValidationError);
    expect(err.toMcpErrorCode()).toBe(ErrorCode.InvalidParams);
  });

  it('maps other errors to InternalError MCP error', () => {
    for (const code of [GwsExitCode.ApiError, GwsExitCode.DiscoveryError, GwsExitCode.InternalError]) {
      const err = new GwsError('fail', code);
      expect(err.toMcpErrorCode()).toBe(ErrorCode.InternalError);
    }
  });
});

describe('parseGwsError', () => {
  it('extracts structured error from JSON stdout', () => {
    const stdout = JSON.stringify({
      error: { code: 401, message: 'Auth failed', reason: 'authError' },
    });
    const err = parseGwsError(2, stdout, '');
    expect(err.message).toBe('Auth failed');
    expect(err.exitCode).toBe(GwsExitCode.AuthError);
    expect(err.reason).toBe('authError');
  });

  it('falls back to stderr when stdout is not JSON', () => {
    const err = parseGwsError(3, '', 'Unknown service: foobar');
    expect(err.message).toBe('Unknown service: foobar');
    expect(err.exitCode).toBe(GwsExitCode.ValidationError);
  });

  it('uses exit code label when stderr is empty', () => {
    const err = parseGwsError(5, '', '');
    expect(err.message).toContain('code 5');
    expect(err.message).toContain('InternalError');
  });
});
