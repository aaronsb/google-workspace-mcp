/**
 * checkAccountStatus — the read side of ADR-202's per-account access level.
 *
 * The migration is the load-bearing part: every credential written before ADR-202 lacks
 * an `access` field and carries read/write scopes. Reading absence as 'read' would lock
 * existing accounts out of operations their tokens permit, and nothing else in the
 * codebase reads that field.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../accounts/credentials.js');
vi.mock('../../accounts/token-service.js');

import { hasCredential, readCredential } from '../../accounts/credentials.js';
import { getAccessToken } from '../../accounts/token-service.js';
import { checkAccountStatus } from '../../accounts/auth.js';

const mockHas = hasCredential as MockedFunction<typeof hasCredential>;
const mockRead = readCredential as MockedFunction<typeof readCredential>;
const mockToken = getAccessToken as MockedFunction<typeof getAccessToken>;

const base = {
  type: 'authorized_user' as const,
  client_id: 'id',
  client_secret: 'secret',
  refresh_token: 'refresh',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockHas.mockResolvedValue(true);
  mockToken.mockResolvedValue('token');
});

describe('checkAccountStatus — access level', () => {
  it('reads a credential with NO access field as full access', async () => {
    // Every account authorized before ADR-202. Their tokens carry gmail.modify, drive,
    // calendar — reading them as read-only would refuse work they are entitled to do.
    mockRead.mockResolvedValue({
      ...base,
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    });

    const status = await checkAccountStatus('a@test.com');

    expect(status.access).toBe('readwrite');
    expect(status.stillAllowWrites).toEqual([]);
  });

  it('reports a stored read-only account as read-only', async () => {
    mockRead.mockResolvedValue({
      ...base,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      access: 'read',
    });

    const status = await checkAccountStatus('a@test.com');
    expect(status.access).toBe('read');
  });

  it('carries the services a confirmed read-only account can still change', async () => {
    mockRead.mockResolvedValue({
      ...base, scopes: [], access: 'read', stillAllowWrites: ['meet'],
    });

    const status = await checkAccountStatus('a@test.com');
    expect(status.stillAllowWrites).toEqual(['meet']);
  });

  it('reports the scopes GRANTED, which can be fewer than were requested', async () => {
    // The consent screen lets a user untick individual permissions, so what was asked
    // for and what was granted are different facts. The stored set is the granted one.
    mockRead.mockResolvedValue({
      ...base,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      access: 'readwrite',
    });

    const status = await checkAccountStatus('a@test.com');
    expect(status.scopes).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
    expect(status.scopeCount).toBe(1);
  });

  it('defaults to full access for an account with no credential at all', async () => {
    mockHas.mockResolvedValue(false);

    const status = await checkAccountStatus('missing@test.com');

    expect(status.tokenValid).toBe(false);
    expect(status.access).toBe('readwrite');
  });
});
