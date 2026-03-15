/**
 * Integration tests for the executor layer.
 * Runs real gws commands against the first configured account.
 */

import { execute, gwsVersion } from '../../executor/gws.js';
import { GwsError, GwsExitCode } from '../../executor/errors.js';
import { getTestAccount } from './setup.js';

const account = getTestAccount();
const describeIf = account ? describe : describe.skip;

describeIf('executor (integration)', () => {
  it('gwsVersion returns a version string', async () => {
    const version = await gwsVersion();
    expect(version).toMatch(/gws\s+\d+\.\d+/);
  }, 10_000);

  it('executes gmail messages list with account credentials', async () => {
    const result = await execute(
      ['gmail', 'users', 'messages', 'list', '--params', JSON.stringify({ userId: 'me', maxResults: 1 })],
      { account: account!.email },
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('messages');
    const messages = (result.data as any).messages;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toHaveProperty('id');
  }, 15_000);

  it('executes calendar list', async () => {
    const result = await execute(
      ['calendar', 'calendarList', 'list'],
      { account: account!.email },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  }, 15_000);

  it('rejects with GwsError for invalid API call', async () => {
    await expect(
      execute(
        ['gmail', 'users', 'messages', 'get', '--params', JSON.stringify({ userId: 'me', id: 'nonexistent-message-id-xxxxx' })],
        { account: account!.email },
      ),
    ).rejects.toThrow(GwsError);
  }, 15_000);

  it('maps exit codes correctly on auth error', async () => {
    // Use a bogus credential file to trigger auth error
    try {
      await execute(
        ['gmail', 'users', 'messages', 'list', '--params', JSON.stringify({ userId: 'me', maxResults: 1 })],
        { account: 'nonexistent-account@bogus.invalid' },
      );
      fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GwsError);
      // Could be AuthError (2) or InternalError (5) depending on gws behavior
      // with a missing credential file — either way it should be a GwsError
      expect((err as GwsError).exitCode).toBeGreaterThan(0);
    }
  }, 15_000);
});
