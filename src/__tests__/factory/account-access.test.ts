/**
 * The call-time half of ADR-202: a write from an account authorized read-only is refused
 * here, with a sentence, instead of by Google with a 403.
 *
 * Scope strings are imported from the maps rather than written out, so a test cannot pass
 * by agreeing with a URL that the source has since changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readCredential = vi.hoisted(() => vi.fn());
vi.mock('../../accounts/credentials.js', () => ({ readCredential }));

const { configurePolicies, evaluatePolicies, accountAccess } = await import('../../factory/safety.js');
const { SERVICE_SCOPE_MAP, SERVICE_SCOPE_MAP_READONLY, writeScopesFor, anyScopesFor } =
  await import('../../accounts/oauth.js');
type OperationInfo = Parameters<typeof accountAccess.evaluate>[3];

const ACCOUNT = 'someone@example.com';
const ctx = (operation: string) => ({ operation, params: {}, account: ACCOUNT });

/** The account holds exactly these services' scopes, at the given level. */
function grant(services: string[], level: 'read' | 'readwrite'): void {
  const map = level === 'read' ? SERVICE_SCOPE_MAP_READONLY : SERVICE_SCOPE_MAP;
  readCredential.mockResolvedValue({ scopes: services.flatMap((s) => map[s] ?? []) });
}

const op = (o: Partial<OperationInfo> & Pick<NonNullable<OperationInfo>, 'service' | 'type'>) =>
  ({ googleService: o.service, ...o }) as OperationInfo;

beforeEach(() => configurePolicies([accountAccess]));
afterEach(() => {
  configurePolicies([]);
  readCredential.mockReset();
});

describe('a read/write account', () => {
  it('is unaffected — the policy is a no-op for the default access level', async () => {
    grant(['contacts'], 'readwrite');
    const result = await evaluatePolicies([], ctx('create'), 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.createContact', type: 'action' }));
    expect(result.action).toBe('allow');
  });
});

describe('a read-only account', () => {
  beforeEach(() => grant(['contacts'], 'read'));

  it('may still read', async () => {
    const result = await evaluatePolicies([], ctx('list'), 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.connections.list', type: 'list' }));
    expect(result.action).toBe('allow');
  });

  it('is blocked from writing', async () => {
    const result = await evaluatePolicies([], ctx('create'), 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.createContact', type: 'action' }));
    expect(result.action).toBe('block');
  });

  it('is told the account, the service, and the exact way out', async () => {
    const { reason } = await evaluatePolicies([], ctx('create'), 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.createContact', type: 'action' }));
    expect(reason).toContain(ACCOUNT);
    expect(reason).toContain('read-only');
    // The remedy must name `contacts` — the manifest service the user would re-consent —
    // never `people`, which is a Google API name they never typed and cannot use here.
    expect(reason).toContain(`services:'contacts'`);
    expect(reason).not.toContain(`services:'people'`);
  });
});

describe('a service the account never authorized', () => {
  it('is blocked, and says so rather than claiming read-only', async () => {
    grant(['gmail'], 'readwrite');
    const { action, reason } = await evaluatePolicies([], ctx('get'), 'drive',
      op({ service: 'drive', resource: 'files.get', type: 'detail' }));
    expect(action).toBe('block');
    expect(reason).toContain('never authorized');
    expect(reason).not.toContain('read-only');
  });
});

describe('operations with no `resource` — the pure custom handlers', () => {
  // Six of the seven are writes (gmail send/reply/replyAll/forward, drive upload,
  // calendar create). Enforcing only where a resource exists would exempt exactly the
  // operations most worth enforcing, so these fall back to the manifest `type`.
  it('blocks a write from a read-only account', async () => {
    grant(['gmail'], 'read');
    const result = await evaluatePolicies([], ctx('send'), 'gmail',
      op({ service: 'gmail', type: 'action' }));
    expect(result.action).toBe('block');
  });

  it('allows a read from a read-only account', async () => {
    grant(['calendar'], 'read');
    const result = await evaluatePolicies([], ctx('agenda'), 'calendar',
      op({ service: 'calendar', type: 'list' }));
    expect(result.action).toBe('allow');
  });

  it('allows a write from a read/write account', async () => {
    grant(['gmail'], 'readwrite');
    const result = await evaluatePolicies([], ctx('send'), 'gmail',
      op({ service: 'gmail', type: 'action' }));
    expect(result.action).toBe('allow');
  });
});

describe('what the descriptor says, not what the manifest guessed', () => {
  // MEASURED across every action-typed operation: `drive.export` is the only one a
  // read-only token satisfies, because it is a GET that the manifest labels an action.
  // Google accepts drive.readonly for files.export, so refusing it would deny a read the
  // token genuinely permits. Deriving from the descriptor gets this right for free; a
  // hand-kept list of "write operations" would have got it wrong.
  it('allows drive.export under read-only access, because Google does', async () => {
    grant(['drive'], 'read');
    const result = await evaluatePolicies([], ctx('export'), 'drive',
      op({ service: 'drive', resource: 'files.export', type: 'action' }));
    expect(result.action).toBe('allow');
  });
});

describe('failing open', () => {
  // A safety check that blocks on its own uncertainty is an outage. Every one of these
  // reaches Google, which refuses it independently if it should be refused.
  it('allows when the account has no credential', async () => {
    readCredential.mockRejectedValue(new Error('no credential'));
    const result = await evaluatePolicies([], ctx('create'), 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.createContact', type: 'action' }));
    expect(result.action).toBe('allow');
  });

  it('allows when the credential lists no scopes at all', async () => {
    readCredential.mockResolvedValue({ scopes: [] });
    const result = await evaluatePolicies([], ctx('create'), 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.createContact', type: 'action' }));
    expect(result.action).toBe('allow');
  });

  it('allows when the manifest gave no operation info', async () => {
    grant(['contacts'], 'read');
    const result = await evaluatePolicies([], ctx('create'), 'people');
    expect(result.action).toBe('allow');
  });

  it('allows when there is no account to check', async () => {
    grant(['contacts'], 'read');
    const result = await evaluatePolicies([], { operation: 'create', params: {}, account: '' }, 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.createContact', type: 'action' }));
    expect(result.action).toBe('allow');
  });

  it('allows when the resource is not in the descriptor', async () => {
    grant(['contacts'], 'read');
    const result = await evaluatePolicies([], ctx('create'), 'people',
      op({ service: 'contacts', googleService: 'people', resource: 'people.noSuchMethod', type: 'action' }));
    expect(result.action).toBe('allow');
  });
});

describe('writeScopesFor', () => {
  // The subtraction that makes the read-only case work at all. Two services carry
  // read-only scopes INSIDE their read/write set because they need them either way, so
  // treating the read/write set as "the write scopes" would find one of those on a
  // read-only account and wave the write through.
  it('excludes read-only scopes that also appear in the read/write set', async () => {
    for (const service of ['contacts', 'meet']) {
      const write = writeScopesFor(service);
      for (const readonly of SERVICE_SCOPE_MAP_READONLY[service]) {
        expect(write).not.toContain(readonly);
      }
      expect(write.length).toBeGreaterThan(0);
    }
  });

  it('leaves a service whose sets are disjoint unchanged', async () => {
    expect(writeScopesFor('gmail')).toEqual(SERVICE_SCOPE_MAP.gmail);
  });

  it('never grants a write scope to any read-only grant', async () => {
    // The property the block depends on, across every service at once.
    for (const service of Object.keys(SERVICE_SCOPE_MAP)) {
      const held = new Set(SERVICE_SCOPE_MAP_READONLY[service] ?? []);
      expect(writeScopesFor(service).some((s) => held.has(s))).toBe(false);
    }
  });

  it('returns an empty list for a service that does not exist', async () => {
    expect(writeScopesFor('nonesuch')).toEqual([]);
    expect(anyScopesFor('nonesuch')).toEqual([]);
  });
});
