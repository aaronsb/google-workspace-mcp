import { execute } from '../../executor/gws.js';
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
});
