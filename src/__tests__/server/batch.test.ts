/**
 * Batch mode — one Google request across many resources. ADR-308.
 *
 * The assertions that matter are about the BODY that goes on the wire, because that is
 * Google's shape rather than ours and there is no type protecting it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../google/client.js');
const { call } = await import('../../google/client.js');
const { handleBatch, batchableOperations } = await import('../../server/batch.js');

const mockCall = vi.mocked(call);
const sent = () => mockCall.mock.calls[0];
const body = () => mockCall.mock.calls[0][2] as Record<string, unknown>;

beforeEach(() => mockCall.mockResolvedValue({} as never));
afterEach(() => mockCall.mockReset());

describe('which operations batch', () => {
  it('is derived from the manifest, not listed anywhere', () => {
    const keys = [...batchableOperations().keys()].sort();
    expect(keys).toEqual([
      'manage_contacts.create',
      'manage_contacts.delete',
      'manage_contacts.get',
      'manage_contacts.update',
      'manage_email.modify',
      'manage_email.trash',
    ]);
  });
});

describe('refusing what cannot batch', () => {
  it('names the operations that can, rather than saying no', async () => {
    const result = await handleBatch({
      mode: 'batch', tool: 'manage_calendar', operation: 'delete',
      email: 'u@t.com', items: [{ eventId: 'e1' }],
    });

    expect(result.text).toContain('cannot be batched');
    expect(result.text).toContain('manage_contacts delete');
    expect(result.text).toContain("mode:'queue'");
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('refuses an empty items list', async () => {
    const result = await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'delete', email: 'u@t.com', items: [],
    });
    expect(result.text).toContain('non-empty');
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('refuses without an account', async () => {
    const result = await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'delete', items: [{ contactId: 'people/c1' }],
    });
    expect(result.text).toContain('email');
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe('the body Google receives', () => {
  it('batchDeleteContacts takes resourceNames', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'delete', email: 'u@t.com',
      items: [{ contactId: 'people/c1' }, { contactId: 'people/c2' }],
    });

    expect(sent()[0]).toBe('people');
    expect(sent()[1]).toBe('people.batchDeleteContacts');
    expect(body().resourceNames).toEqual(['people/c1', 'people/c2']);
  });

  it('batchUpdateContacts fetches etags first, then keys contacts by resource name', async () => {
    // MEASURED live: without an etag per person Google answers FAILED_PRECONDITION. So an
    // update is a read-modify-write — one getBatchGet, one batchUpdateContacts. Two calls
    // for N contacts, against the 2N a queue would make.
    mockCall.mockResolvedValueOnce({
      responses: [
        { person: { resourceName: 'people/c1', etag: 'etag-1' } },
        { person: { resourceName: 'people/c2', etag: 'etag-2' } },
      ],
    } as never);
    mockCall.mockResolvedValueOnce({} as never);

    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'update', email: 'u@t.com',
      items: [
        { contactId: 'people/c1', name: 'Ada Lovelace' },
        { contactId: 'people/c2', name: 'Grace Hopper' },
      ],
    });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockCall.mock.calls[0][1]).toBe('people.getBatchGet');
    expect(mockCall.mock.calls[1][1]).toBe('people.batchUpdateContacts');

    const sentBody = mockCall.mock.calls[1][2] as Record<string, any>;
    expect(Object.keys(sentBody.contacts)).toEqual(['people/c1', 'people/c2']);
    expect(sentBody.contacts['people/c1'].etag).toBe('etag-1');
    expect(sentBody.contacts['people/c2'].etag).toBe('etag-2');
    // Flat fields converted the same way single `update` converts them.
    expect(sentBody.contacts['people/c1'].names).toEqual([{ givenName: 'Ada', familyName: 'Lovelace' }]);
    // updateMask derived from what the caller actually supplied, not a fixed list —
    // naming a field with no value in the body CLEARS it.
    expect(sentBody.updateMask).toBe('names');
  });

  it('refuses to update a contact that does not exist, rather than sending a bad etag', async () => {
    mockCall.mockResolvedValueOnce({ responses: [] } as never);

    const result = await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'update', email: 'u@t.com',
      items: [{ contactId: 'people/cGone', name: 'Nobody' }],
    });

    expect(result.text).toContain('No contact found');
    expect(mockCall).toHaveBeenCalledTimes(1);   // the read only; nothing was written
  });

  it('batchCreateContacts takes the same flat fields as single create', async () => {
    // Live, passing flat fields straight through was a 400 from Google: the raw People
    // shape is parallel arrays of objects, which manage_contacts exists to hide.
    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'create', email: 'u@t.com',
      items: [{ name: 'Ada Lovelace', contactEmail: 'ada@example.com' }],
    });

    const contacts = body().contacts as any[];
    expect(contacts[0].contactPerson.names).toEqual([{ givenName: 'Ada', familyName: 'Lovelace' }]);
    expect(contacts[0].contactPerson.emailAddresses).toEqual([{ value: 'ada@example.com' }]);
  });

  it('getBatchGet sends resourceNames and a field mask', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'get', email: 'u@t.com',
      items: [{ contactId: 'people/c1' }],
    });

    expect(sent()[1]).toBe('people.getBatchGet');
    expect(body().resourceNames).toEqual(['people/c1']);
    expect(body().personFields).toBeTruthy();
  });

  it('batchCreateContacts wraps each item as a contactPerson', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'create', email: 'u@t.com',
      items: [{ person: { names: [{ givenName: 'Ada' }] } }],
    });

    expect(body().contacts).toEqual([{ contactPerson: { names: [{ givenName: 'Ada' }] } }]);
    expect(body().readMask).toBeTruthy();
  });
});

describe('shared arguments versus per-item arguments', () => {
  // The rule that lets one shape serve five Google methods: top-level args are shared,
  // items carry what differs. A parameter that varies per item is not a batch.
  it('takes label changes from the top level and ids from items', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_email', operation: 'modify', email: 'u@t.com',
      addLabelIds: 'STARRED', removeLabelIds: 'UNREAD',
      items: [{ messageId: 'm1' }, { messageId: 'm2' }, { messageId: 'm3' }],
    });

    expect(sent()[1]).toBe('users.messages.batchModify');
    expect(body()).toEqual({
      // A required PATH parameter, from the batch block's defaults. Omitting it failed
      // live with "missing required path param 'userId'" after passing every mocked test.
      userId: 'me',
      ids: ['m1', 'm2', 'm3'],
      addLabelIds: ['STARRED'],
      removeLabelIds: ['UNREAD'],
    });
  });

  it('accepts a comma string or an array for labels', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_email', operation: 'modify', email: 'u@t.com',
      addLabelIds: ['STARRED', 'IMPORTANT'], items: [{ messageId: 'm1' }],
    });
    expect(body().addLabelIds).toEqual(['STARRED', 'IMPORTANT']);
  });
});

describe('bulk trash', () => {
  // Gmail publishes no bulk trash. Trashing many messages is batchModify adding the TRASH
  // label — reversible, and on the gmail.modify scope already held. The manifest carries
  // that translation so the caller asks to trash and never sees a label.
  it('routes trash through batchModify with the TRASH label', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_email', operation: 'trash', email: 'u@t.com',
      items: [{ messageId: 'm1' }, { messageId: 'm2' }],
    });

    expect(sent()[1]).toBe('users.messages.batchModify');
    expect(body()).toEqual({ userId: 'me', ids: ['m1', 'm2'], addLabelIds: ['TRASH'] });
  });

  it('is one request regardless of how many messages', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_email', operation: 'trash', email: 'u@t.com',
      items: Array.from({ length: 200 }, (_, i) => ({ messageId: `m${i}` })),
    });

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect((body().ids as string[]).length).toBe(200);
  });
});

describe('reporting what Google actually said', () => {
  it('does not invent per-item status when Google returns no body', async () => {
    mockCall.mockResolvedValue({} as never);
    const result = await handleBatch({
      mode: 'batch', tool: 'manage_email', operation: 'trash', email: 'u@t.com',
      items: [{ messageId: 'm1' }],
    });

    // batchModify answers 204 with nothing. Claiming "1 succeeded" would be fabrication.
    expect(result.text).toContain('does not report per-item status');
  });

  it('reports the count when Google does return results', async () => {
    mockCall.mockResolvedValue({ createContacts: [{}, {}] } as never);
    const result = await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'create', email: 'u@t.com',
      items: [{ person: {} }, { person: {} }],
    });

    expect(result.text).toContain('2 results returned');
  });
});

describe('batch goes through the safety layer', () => {
  // Batch reaches Google without passing through generateHandler, so it gets no policy
  // check for free — the same defect as manage_scratchpad (#171), in newer code. Doing
  // many writes at once is the last place to skip it: a read-only account refused one
  // contact deletion must not be permitted two hundred.
  it('refuses a read-only account, and never calls Google', async () => {
    const { configurePolicies, accountAccess } = await import('../../factory/safety.js');
    const { SERVICE_SCOPE_MAP_READONLY } = await import('../../accounts/oauth.js');
    const creds = await import('../../accounts/credentials.js');
    const spy = vi.spyOn(creds, 'readCredential').mockResolvedValue(
      { scopes: SERVICE_SCOPE_MAP_READONLY.contacts } as never,
    );
    configurePolicies([accountAccess]);

    try {
      const result = await handleBatch({
        mode: 'batch', tool: 'manage_contacts', operation: 'delete', email: 'u@t.com',
        items: [{ contactId: 'people/c1' }, { contactId: 'people/c2' }],
      });

      expect(result.text).toContain('Blocked by safety policy');
      expect(result.text).toContain("services:'contacts'");
      expect(mockCall).not.toHaveBeenCalled();
    } finally {
      configurePolicies([]);
      spy.mockRestore();
    }
  });
});

describe('rendering results the agent can use', () => {
  // `refs` never reaches the model — the server returns result.text only. Live, batch
  // `get` answered "2 results returned" and threw the two people away, which makes a
  // batch READ pointless.
  it('prints the people a batch get returned', async () => {
    mockCall.mockResolvedValue({
      responses: [
        { person: { resourceName: 'people/c1', names: [{ displayName: 'Ada Lovelace' }], emailAddresses: [{ value: 'ada@example.com' }] } },
        { person: { resourceName: 'people/c2', names: [{ displayName: 'Grace Hopper' }] } },
      ],
    } as never);

    const result = await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'get', email: 'u@t.com',
      items: [{ contactId: 'people/c1' }, { contactId: 'people/c2' }],
    });

    expect(result.text).toContain('people/c1');
    expect(result.text).toContain('Ada Lovelace');
    expect(result.text).toContain('ada@example.com');
    expect(result.text).toContain('Grace Hopper');
  });

  it('prints what a batch create created, so the ids can be acted on', async () => {
    mockCall.mockResolvedValue({
      createdPeople: [{ httpStatusCode: 200, person: { resourceName: 'people/cNew', names: [{ displayName: 'Ada Lovelace' }] } }],
    } as never);

    const result = await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'create', email: 'u@t.com',
      items: [{ name: 'Ada Lovelace' }],
    });

    expect(result.text).toContain('people/cNew');
    expect(result.text).toContain('Ada Lovelace');
  });
});

describe('low-friction item forms', () => {
  // The standing rule: a tool call should be easy to write, with sensible defaults doing
  // the work. A caller holding a list of ids should be able to pass a list of ids.
  it('accepts bare id strings', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'delete', email: 'u@t.com',
      items: ['people/c1', 'people/c2'],
    });
    expect(body().resourceNames).toEqual(['people/c1', 'people/c2']);
  });

  it('accepts bare message ids for trash', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_email', operation: 'trash', email: 'u@t.com',
      items: ['m1', 'm2'],
    });
    expect(body()).toEqual({ userId: 'me', ids: ['m1', 'm2'], addLabelIds: ['TRASH'] });
  });

  it('adds the people/ prefix a caller left off, as the single operations do', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'delete', email: 'u@t.com',
      items: ['c1', { contactId: 'c2' }],
    });
    expect(body().resourceNames).toEqual(['people/c1', 'people/c2']);
  });

  it('still takes the object form when items carry more than an id', async () => {
    await handleBatch({
      mode: 'batch', tool: 'manage_contacts', operation: 'create', email: 'u@t.com',
      items: [{ name: 'Ada Lovelace', contactEmail: 'ada@example.com' }],
    });
    const contacts = body().contacts as any[];
    expect(contacts[0].contactPerson.names).toEqual([{ givenName: 'Ada', familyName: 'Lovelace' }]);
  });
});
