import { GwsError, GwsExitCode, parseGwsError } from '../../executor/errors.js';

describe('GwsError', () => {
  it('stores exit code and reason', () => {
    const err = new GwsError('bad auth', GwsExitCode.AuthError, 'authError', 'stderr output');
    expect(err.message).toBe('bad auth');
    expect(err.exitCode).toBe(GwsExitCode.AuthError);
    expect(err.reason).toBe('authError');
    expect(err.stderr).toBe('stderr output');
    expect(err.name).toBe('GwsError');
  });

  it('is an instance of Error', () => {
    const err = new GwsError('fail', GwsExitCode.InternalError);
    expect(err).toBeInstanceOf(Error);
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

  it('handles malformed JSON in stdout', () => {
    const err = parseGwsError(1, '{not valid json', 'some error');
    expect(err.message).toBe('some error');
    expect(err.exitCode).toBe(GwsExitCode.ApiError);
  });
});
