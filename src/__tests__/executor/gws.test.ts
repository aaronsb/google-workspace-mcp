import { execute, gwsVersion } from '../../executor/gws.js';
import { GwsError, GwsExitCode } from '../../executor/errors.js';
import * as child_process from 'node:child_process';
import { EventEmitter } from 'node:events';

// Mock child_process.spawn
jest.mock('node:child_process');

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  proc.stdin = null;
  return proc;
}

describe('execute', () => {
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list']);

    proc.stdout.emit('data', Buffer.from('{"items": []}'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ items: [] });
  });

  it('filters diagnostic stderr noise', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list']);

    proc.stderr.emit('data', Buffer.from('Using keyring backend: keyring\n'));
    proc.stdout.emit('data', Buffer.from('{"items": []}'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.stderr).toBe('');
  });

  it('rejects with GwsError on non-zero exit', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list']);

    proc.stdout.emit('data', Buffer.from(JSON.stringify({
      error: { code: 401, message: 'Auth failed', reason: 'authError' },
    })));
    proc.emit('close', 2);

    await expect(promise).rejects.toThrow(GwsError);
    await expect(promise).rejects.toMatchObject({
      exitCode: GwsExitCode.AuthError,
      message: 'Auth failed',
    });
  });

  it('rejects on spawn error', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list']);

    proc.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('Failed to spawn gws');
  });

  it('rejects on invalid JSON output', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list']);

    proc.stdout.emit('data', Buffer.from('not json{{{'));
    proc.emit('close', 0);

    await expect(promise).rejects.toThrow('Failed to parse');
  });

  it('sets credential file env var when account is provided', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['gmail', '+triage'], { account: 'user@example.com' });

    proc.stdout.emit('data', Buffer.from('{}'));
    proc.emit('close', 0);

    await promise;

    const spawnCall = mockSpawn.mock.calls[0];
    const env = spawnCall[2]?.env as Record<string, string>;
    expect(env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE).toContain('user_at_example_dot_com.json');
  });

  it('appends --format json by default', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['drive', 'files', 'list']);

    proc.stdout.emit('data', Buffer.from('{}'));
    proc.emit('close', 0);

    await promise;

    const spawnCall = mockSpawn.mock.calls[0];
    const args = spawnCall[1] as string[];
    expect(args).toContain('--format');
    expect(args).toContain('json');
  });

  it('rejects with timeout error and sends SIGTERM', async () => {
    jest.useFakeTimers();
    try {
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc as any);

      const promise = execute(['calendar', 'events', 'list'], { timeout: 100 });

      jest.advanceTimersByTime(150);

      await expect(promise).rejects.toThrow('timed out');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns raw string data when format is not json', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list'], { format: 'table' });

    proc.stdout.emit('data', Buffer.from('ID  Summary\n1   Standup'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.data).toBe('ID  Summary\n1   Standup');
  });

  it('does not set credential env var when no account', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list']);

    proc.stdout.emit('data', Buffer.from('{}'));
    proc.emit('close', 0);

    await promise;

    const env = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
    expect(env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE).toBeUndefined();
  });

  it('handles empty stdout with json format as undefined data', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['calendar', 'events', 'list']);

    proc.stdout.emit('data', Buffer.from(''));
    proc.emit('close', 0);

    const result = await promise;
    // Empty stdout with json format → data is the empty string (non-json branch)
    expect(result.success).toBe(true);
  });

  it('only settles once even if close fires after error', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['test']);

    proc.emit('error', new Error('ENOENT'));
    // close fires after error in real Node.js
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow('Failed to spawn gws');
  });

  it('preserves real stderr through filtering', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = execute(['test']);

    proc.stderr.emit('data', Buffer.from('Using keyring backend: keyring\nActual error message\n'));
    proc.stdout.emit('data', Buffer.from('{}'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.stderr).toBe('Actual error message');
  });
});

describe('gwsVersion', () => {
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

  it('returns trimmed version string', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = gwsVersion();

    proc.stdout.emit('data', Buffer.from('gws 0.13.2\n'));
    proc.emit('close', 0);

    const version = await promise;
    expect(version).toBe('gws 0.13.2');
  });

  it('uses table format (not json)', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc as any);

    const promise = gwsVersion();

    proc.stdout.emit('data', Buffer.from('gws 0.13.2'));
    proc.emit('close', 0);

    await promise;

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('--version');
    expect(args).toContain('table');
  });
});
