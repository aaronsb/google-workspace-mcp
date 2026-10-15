/**
 * `authenticate` with `services` — the FIRST grant holds only the scopes asked for.
 *
 * Without this, a read-only account briefly held eleven read-only scopes before being
 * narrowed with `scopes`, and could not be authorized at all under a Workspace admin
 * allowlist that permits only the narrower set.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../accounts/oauth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../accounts/oauth.js')>();
  return { ...actual, runOAuthFlow: vi.fn() };
});
vi.mock('../../accounts/credentials.js');
vi.mock('../../accounts/token-service.js');

import { runOAuthFlow } from '../../accounts/oauth.js';
import { saveCredential } from '../../accounts/credentials.js';
import { authenticateAccount } from '../../accounts/auth.js';

const mockFlow = runOAuthFlow as MockedFunction<typeof runOAuthFlow>;
const mockSave = saveCredential as MockedFunction<typeof saveCredential>;

const READONLY_THREE = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

beforeEach(() => {
  vi.resetAllMocks();
  mockSave.mockResolvedValue('/tmp/cred.json');
});

describe('authenticateAccount — services narrows the first grant', () => {
  it('requests exactly the read-only scopes for the named services, nothing else', async () => {
    mockFlow.mockImplementation(async (_id, _secret, scopes) => ({
      email: 'a@test.com', accessToken: 'at', refreshToken: 'rt', expiresIn: 3600, scopes,
    }));

    const result = await authenticateAccount('id', 'secret', 'read', 'gmail,drive,calendar');

    expect(result.status).toBe('success');
    expect(mockFlow).toHaveBeenCalledTimes(1);
    const requested = mockFlow.mock.calls[0][2];
    expect([...requested].sort()).toEqual([...READONLY_THREE].sort());
    // No write scope and no scope for an unrequested service.
    expect(requested.some(s => /modify|\/auth\/drive$|\/auth\/calendar$|spreadsheets|documents|tasks|presentations|meetings|contacts|directory/.test(s))).toBe(false);
  });

  it('stores the granted scopes and access level on the credential', async () => {
    mockFlow.mockImplementation(async (_id, _secret, scopes) => ({
      email: 'a@test.com', accessToken: 'at', refreshToken: 'rt', expiresIn: 3600, scopes,
    }));

    await authenticateAccount('id', 'secret', 'read', 'gmail,drive,calendar');

    expect(mockSave).toHaveBeenCalledTimes(1);
    const [email, cred] = mockSave.mock.calls[0];
    expect(email).toBe('a@test.com');
    expect(cred.access).toBe('read');
    expect([...(cred.scopes ?? [])].sort()).toEqual([...READONLY_THREE].sort());
  });

  it('still requests every service when services is omitted (existing behaviour)', async () => {
    mockFlow.mockImplementation(async (_id, _secret, scopes) => ({
      email: 'a@test.com', accessToken: 'at', refreshToken: 'rt', expiresIn: 3600, scopes,
    }));

    await authenticateAccount('id', 'secret', 'read');

    const requested = mockFlow.mock.calls[0][2];
    expect(requested).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');
    expect(requested).toContain('https://www.googleapis.com/auth/contacts.readonly');
  });

  it('rejects an unknown service name before opening a browser', async () => {
    await expect(authenticateAccount('id', 'secret', 'read', 'gmail,bogus')).rejects.toThrow(/Unknown service/);
    expect(mockFlow).not.toHaveBeenCalled();
  });
});
