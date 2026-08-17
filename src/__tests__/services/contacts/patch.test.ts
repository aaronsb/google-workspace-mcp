/**
 * Contacts patch tests — the field masks, the four envelopes, and the parallel arrays.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

vi.mock('../../../google/client.js');
import { call } from '../../../google/client.js';
const mockCall = call as MockedFunction<typeof call>;

import { loadManifest, generateHandler } from '../../../factory/generator.js';
import { patches } from '../../../factory/patches.js';
import { contactsPatch, resetWarmupCache } from '../../../services/contacts/patch.js';
import type { PatchContext } from '../../../factory/types.js';

const manifest = loadManifest();
const handler = generateHandler(manifest.services.contacts, patches.contacts);

function ctx(operation: string, params: Record<string, unknown> = {}): PatchContext {
  return { operation, params, account: 'u@t.com' };
}

/**
 * The params handed to Google by the LAST call() — what actually goes on the wire.
 *
 * Last, not first: the search operations fire a warmup call ahead of the real one, so
 * indexing from the front would assert against the warmup and pass while the real
 * request carried nothing.
 */
function sent(): Record<string, unknown> {
  return mockCall.mock.calls[mockCall.mock.calls.length - 1][2];
}

beforeEach(() => {
  mockCall.mockReset();
  resetWarmupCache();
});

/**
 * The People API REJECTS a read that does not name its fields, so a mask that stopped
 * being sent would break every operation at once — against Google, and nowhere else.
 *
 * This is the test that did not exist for `includeTabsContent`: deleting that default
 * left the suite green and returned the bug it had been added to fix. Each operation is
 * pinned to the mask it needs, so removing one from the YAML fails here.
 */
describe('the field mask every read requires', () => {
  it.each([
    ['list',            'personFields', 'names,emailAddresses,phoneNumbers,organizations,metadata'],
    ['get',             'personFields', 'names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,birthdays,biographies,urls,relations,memberships,photos,metadata'],
    ['search',          'readMask',     'names,emailAddresses,phoneNumbers,organizations,metadata'],
    ['listOther',       'readMask',     'names,emailAddresses,phoneNumbers,metadata'],
    ['searchOther',     'readMask',     'names,emailAddresses,phoneNumbers,metadata'],
    ['listDirectory',   'readMask',     'names,emailAddresses,phoneNumbers,organizations,metadata'],
    ['searchDirectory', 'readMask',     'names,emailAddresses,phoneNumbers,organizations,metadata'],
  ])('%s sends %s', async (operation, key, mask) => {
    mockCall.mockResolvedValue({});
    await handler({ operation, email: 'u@t.com', query: 'x', contactId: 'people/c1' });
    expect(sent()[key]).toBe(mask);
  });

  it('never asks otherContacts for a field it refuses to return', async () => {
    // otherContacts accepts a narrower mask than the contact operations: asking it for
    // organizations is a 400, not an empty column.
    mockCall.mockResolvedValue({});
    await handler({ operation: 'listOther', email: 'u@t.com' });
    expect(String(sent().readMask)).not.toContain('organizations');
  });

  it('reads the caller`s own connections without making the agent name itself', async () => {
    mockCall.mockResolvedValue({});
    await handler({ operation: 'list', email: 'u@t.com' });
    expect(sent().resourceName).toBe('people/me');
  });

  it('tells the directory operations which directory to read', async () => {
    // `sources` is required on both directory operations — omitting it is an error,
    // not a default.
    mockCall.mockResolvedValue({});
    await handler({ operation: 'listDirectory', email: 'u@t.com' });
    expect(sent().sources).toBe('DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE,DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT');
  });
});

describe('request shaping', () => {
  it('accepts a person id with or without its people/ prefix', async () => {
    mockCall.mockResolvedValue({});
    await handler({ operation: 'get', email: 'u@t.com', contactId: 'c1234567890' });
    expect(sent().resourceName).toBe('people/c1234567890');

    mockCall.mockReset();
    mockCall.mockResolvedValue({});
    await handler({ operation: 'get', email: 'u@t.com', contactId: 'people/c1234567890' });
    expect(sent().resourceName).toBe('people/c1234567890');
  });

  it('translates the sort order it advertises into the constant Google wants', async () => {
    mockCall.mockResolvedValue({});
    await handler({ operation: 'list', email: 'u@t.com', sortOrder: 'lastModified' });
    expect(sent().sortOrder).toBe('LAST_MODIFIED_DESCENDING');
  });

  it('sorts by first name unless asked otherwise', async () => {
    mockCall.mockResolvedValue({});
    await handler({ operation: 'list', email: 'u@t.com' });
    expect(sent().sortOrder).toBe('FIRST_NAME_ASCENDING');
  });

  it('refuses a sort order it cannot translate, rather than passing it through', async () => {
    // The low-level MCP handler does not validate against inputSchema, so the advertised
    // enum stops nothing. Passed through, `LAST_MODIFIED_ASCENDING` would be a Google
    // 400 blamed on the caller for using a value the API does document.
    mockCall.mockResolvedValue({});
    await expect(
      handler({ operation: 'list', email: 'u@t.com', sortOrder: 'LAST_MODIFIED_ASCENDING' }),
    ).rejects.toThrow('sortOrder must be one of');
  });

  it('clamps maxResults to what each operation allows', async () => {
    mockCall.mockResolvedValue({});
    await handler({ operation: 'search', email: 'u@t.com', query: 'a', maxResults: 500 });
    expect(sent().pageSize).toBe(30);

    mockCall.mockReset();
    mockCall.mockResolvedValue({});
    await handler({ operation: 'list', email: 'u@t.com', maxResults: 500 });
    expect(sent().pageSize).toBe(100);
  });
});

/**
 * Six operations, four envelope keys. A shape the reader does not know renders as
 * "No contacts found" — a confident, wrong answer, and the failure mode this repo has
 * already shipped once.
 */
/**
 * The write half of the same shape problem the formatters solve for reads.
 *
 * Anything sent that Google does not recognise as a query parameter lands in the request
 * BODY verbatim, so a flat `name` is accepted, ignored, and returns 200 with a nameless
 * contact. There is no error anywhere in that failure — only a wrong contact.
 */
describe('create builds the Person body', () => {
  it('sends names as a parallel array with the parts split out', async () => {
    mockCall.mockResolvedValue({ resourceName: 'people/c1' });
    await handler({ operation: 'create', email: 'u@t.com', name: 'Ada Lovelace' });

    expect(sent().names).toEqual([{ givenName: 'Ada', familyName: 'Lovelace' }]);
    expect(sent().name).toBeUndefined();   // the flat param must not survive
  });

  it('treats a single word as a given name rather than inventing a surname', async () => {
    mockCall.mockResolvedValue({ resourceName: 'people/c1' });
    await handler({ operation: 'create', email: 'u@t.com', name: 'Prince' });
    expect(sent().names).toEqual([{ givenName: 'Prince' }]);
  });

  it('keeps a multi-part family name whole', async () => {
    mockCall.mockResolvedValue({ resourceName: 'people/c1' });
    await handler({ operation: 'create', email: 'u@t.com', name: 'Ada van der Meer' });
    expect(sent().names).toEqual([{ givenName: 'Ada', familyName: 'van der Meer' }]);
  });

  it('does not confuse the contact`s address with the account making the call', async () => {
    mockCall.mockResolvedValue({ resourceName: 'people/c1' });
    await handler({ operation: 'create', email: 'caller@t.com', contactEmail: 'saved@example.com' });

    expect(sent().emailAddresses).toEqual([{ value: 'saved@example.com' }]);
    expect(JSON.stringify(sent())).not.toContain('caller@t.com');
  });

  it('folds company and title into one organization entry', async () => {
    mockCall.mockResolvedValue({ resourceName: 'people/c1' });
    await handler({ operation: 'create', email: 'u@t.com', company: 'Acme', jobTitle: 'Field Engineer' });
    expect(sent().organizations).toEqual([{ name: 'Acme', title: 'Field Engineer' }]);
  });

  it('sends notes as a biography with its content type', async () => {
    mockCall.mockResolvedValue({ resourceName: 'people/c1' });
    await handler({ operation: 'create', email: 'u@t.com', notes: 'Met at the offsite.' });
    expect(sent().biographies).toEqual([{ value: 'Met at the offsite.', contentType: 'TEXT_PLAIN' }]);
  });

  it('refuses to create a contact with nothing in it', async () => {
    // Google accepts an empty Person and answers 200 with a record carrying nothing but
    // an id. Refusing here is the only way the caller learns.
    mockCall.mockResolvedValue({});
    await expect(handler({ operation: 'create', email: 'u@t.com' }))
      .rejects.toThrow('needs at least one of');
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('ignores whitespace-only values rather than storing them', async () => {
    mockCall.mockResolvedValue({});
    await expect(handler({ operation: 'create', email: 'u@t.com', name: '   ' }))
      .rejects.toThrow('needs at least one of');
  });

  it('echoes back every field it can write, so the note is not silently dropped', async () => {
    // Live, the create confirmation omitted a note it had just stored, because the read
    // mask on the write was narrower than the write itself.
    mockCall.mockResolvedValue({});
    await handler({ operation: 'create', email: 'u@t.com', notes: 'x' });
    for (const field of ['names', 'emailAddresses', 'phoneNumbers', 'organizations', 'biographies']) {
      expect(String(sent().personFields)).toContain(field);
    }
  });

  it('reports the new id, which is the only handle on what it just made', async () => {
    mockCall.mockResolvedValue({
      resourceName: 'people/c777',
      names: [{ displayName: 'Ada Lovelace' }],
      emailAddresses: [{ value: 'ada@example.com' }],
    });
    const out = await handler({ operation: 'create', email: 'u@t.com', name: 'Ada Lovelace' });

    expect(out.text).toContain('Contact created');
    expect(out.text).toContain('people/c777');
    expect(out.text).toContain('ada@example.com');
    expect(out.refs?.contactId).toBe('people/c777');
  });
});

/**
 * `updatePersonFields` REPLACES every entry in each field it names, and naming a field
 * with nothing in the body CLEARS it. That is the #161 shape — `calendar.attendees`
 * silently replacing a whole list — with an extra edge: the list is not something the
 * caller passes, it is something this code derives. Derive it wrong and the operation
 * destroys data the caller never mentioned.
 */
describe('update', () => {
  const existing = {
    resourceName: 'people/c1',
    etag: '%EgUBAj0KPg==',
    names: [{ displayName: 'Claude Bockelie' }],
    emailAddresses: [{ value: 'claude@bockelie.com' }],
    organizations: [{ name: 'Anthropic', title: 'Agent' }],
  };

  /** update reads before it writes: call 0 is the GET, call 1 is the PATCH. */
  function patched(): Record<string, unknown> {
    return mockCall.mock.calls[1][2];
  }

  beforeEach(() => {
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce(existing).mockResolvedValue({ ...existing });
  });

  it('names ONLY the fields the caller passed', async () => {
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: '555-0100' });

    expect(patched().updatePersonFields).toBe('phoneNumbers');
    expect(patched().phoneNumbers).toEqual([{ value: '555-0100' }]);
  });

  it('does not name a field the caller left alone', async () => {
    // Naming emailAddresses here with no address in the body would delete the contact's
    // email as a side effect of setting a phone number.
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: '555-0100' });

    expect(String(patched().updatePersonFields)).not.toContain('emailAddresses');
    expect(patched().emailAddresses).toBeUndefined();
  });

  it('clears a field when passed an empty string', async () => {
    // Named in updatePersonFields, absent from the body — which is how Google is told
    // to empty a field.
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: '' });

    expect(patched().updatePersonFields).toBe('phoneNumbers');
    expect(patched().phoneNumbers).toBeUndefined();
  });

  it('sends the etag Google requires, read from the current record', async () => {
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: '555-0100' });

    expect(mockCall.mock.calls[0][1]).toBe('people.get');
    expect(patched().etag).toBe('%EgUBAj0KPg==');
  });

  it('keeps the employer when only the job title changes', async () => {
    // company and jobTitle write to the SAME Person field. Replacing organizations with
    // a title alone would drop the employer — a loss inside one field, from a parameter
    // that never mentioned the employer.
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', jobTitle: 'Principal Agent' });

    expect(patched().organizations).toEqual([{ name: 'Anthropic', title: 'Principal Agent' }]);
  });

  it('keeps the job title when only the employer changes', async () => {
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', company: 'Acme' });
    expect(patched().organizations).toEqual([{ name: 'Acme', title: 'Agent' }]);
  });

  it('keeps the organization fields this tool does not expose', async () => {
    // Writing either half rewrites the whole organizations array, and an earlier version
    // rebuilt it as {name, title} — discarding department, type and startDate, which the
    // read half already had in hand. Correcting a job title erased an employment record,
    // and the confirmation looked right because it only renders name and title.
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce({
      resourceName: 'people/c1',
      etag: 'e',
      // Every subfield here was measured as one Google actually round-trips. An earlier
      // version of this fixture used startDate, which Google returns and then rejects
      // with a 500 — the test asserted a survival that could never have happened.
      organizations: [{
        name: 'Acme', title: 'Engineer', department: 'R&D', type: 'work',
        jobDescription: 'builds things', location: 'Seattle',
        metadata: { primary: true },
      }],
    }).mockResolvedValue({ resourceName: 'people/c1' });

    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', jobTitle: 'Principal' });

    expect(patched().organizations).toEqual([{
      name: 'Acme', title: 'Principal', department: 'R&D', type: 'work',
      jobDescription: 'builds things', location: 'Seattle',
    }]);
  });

  it('keeps a second organization the caller never mentioned', async () => {
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce({
      resourceName: 'people/c1',
      etag: 'e',
      organizations: [
        { name: 'Acme', title: 'Engineer', metadata: { primary: true } },
        { name: 'Side Consultancy', title: 'Partner' },
      ],
    }).mockResolvedValue({ resourceName: 'people/c1' });

    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', jobTitle: 'Principal' });

    expect(patched().organizations).toEqual([
      { name: 'Acme', title: 'Principal' },
      { name: 'Side Consultancy', title: 'Partner' },
    ]);
  });

  it('refuses an organization edit Google would answer with a bare 500', async () => {
    // Measured on live Google: an organizations entry carrying startDate or endDate is
    // answered `500 Internal error encountered`, on create and update alike. Carrying it
    // through would fail with nothing the caller can act on; dropping it would lose
    // employment history nobody asked to change.
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce({
      resourceName: 'people/c1',
      etag: 'e',
      organizations: [{ name: 'Acme', title: 'Engineer', startDate: { year: 2019 } }],
    }).mockResolvedValue({ resourceName: 'people/c1' });

    await expect(handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', jobTitle: 'Principal' }))
      .rejects.toThrow(/startDate.*rejects on write/s);

    expect(mockCall.mock.calls.filter(c => c[1] === 'people.updateContact')).toHaveLength(0);
  });

  it('names both offending fields when both are present', async () => {
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce({
      resourceName: 'people/c1',
      etag: 'e',
      organizations: [{ name: 'Acme', startDate: { year: 2019 }, endDate: { year: 2021 } }],
    }).mockResolvedValue({});

    await expect(handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', company: 'Beta' }))
      .rejects.toThrow(/startDate and endDate/);
  });

  it('leaves other fields updatable on a contact with employment dates', async () => {
    // The refusal is scoped to the organizations rebuild. A phone change never touches
    // that field, so it must still go through.
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce({
      resourceName: 'people/c1',
      etag: 'e',
      organizations: [{ name: 'Acme', startDate: { year: 2019 } }],
    }).mockResolvedValue({ resourceName: 'people/c1' });

    await expect(handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: '555-0100' }))
      .resolves.toBeDefined();
    expect(patched().updatePersonFields).toBe('phoneNumbers');
  });

  it('does not send back the metadata Google owns', async () => {
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', jobTitle: 'Principal' });
    expect(JSON.stringify(patched().organizations)).not.toContain('metadata');
  });

  it('clears the employer on an empty string without disturbing the title', async () => {
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', company: '' });
    expect(patched().organizations).toEqual([{ title: 'Agent' }]);
  });

  it('refuses an update that changes nothing', async () => {
    await expect(handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1' }))
      .rejects.toThrow('needs at least one of');
  });

  it('accepts a bare id', async () => {
    await handler({ operation: 'update', email: 'u@t.com', contactId: 'c1', phone: '555-0100' });
    expect(patched().resourceName).toBe('people/c1');
  });

  it('says it updated, not created', async () => {
    const out = await handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: '555-0100' });
    expect(out.text).toContain('Contact updated');
  });
});

/**
 * The two halves of a write are derived from different facts: `updatePersonFields` from
 * whether a parameter ARRIVED, the body from whether it is a usable string. Anything that
 * is present but not a string splits them — the field gets named with nothing behind it,
 * which is exactly how Google is told to DELETE it.
 *
 * The MCP handler does not validate against inputSchema, and buildResourceParams filters
 * only undefined and null, so a number or an array reaches the hook untouched.
 */
describe('non-string values are refused, not silently dropped', () => {
  it.each([
    ['a number', 5550100],
    ['an array', ['a@x.com', 'b@x.com']],
    ['an object', { value: 'x' }],
    ['a boolean', true],
  ])('update refuses %s rather than clearing the field', async (_label, value) => {
    mockCall.mockReset();
    mockCall.mockResolvedValue({ resourceName: 'people/c1', etag: 'e' });

    await expect(handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: value }))
      .rejects.toThrow('phone must be a string');

    // Nothing may reach Google — not even the read half — once the input is unusable.
    const patchCalls = mockCall.mock.calls.filter(c => c[1] === 'people.updateContact');
    expect(patchCalls).toHaveLength(0);
  });

  it('create refuses a non-string instead of reporting the field missing', async () => {
    // Dropping it silently made the error name the very parameter the caller supplied.
    mockCall.mockResolvedValue({});
    await expect(handler({ operation: 'create', email: 'u@t.com', phone: 5550100 }))
      .rejects.toThrow('phone must be a string');
  });

  it('still accepts an empty string as a deliberate clear', async () => {
    mockCall.mockReset();
    mockCall.mockResolvedValueOnce({ resourceName: 'people/c1', etag: 'e', phoneNumbers: [{ value: '1' }] })
      .mockResolvedValue({ resourceName: 'people/c1' });
    await expect(handler({ operation: 'update', email: 'u@t.com', contactId: 'people/c1', phone: '' }))
      .resolves.toBeDefined();
  });
});

describe('delete', () => {
  it('names what it deleted, since Google returns an empty body', async () => {
    mockCall.mockResolvedValue({});
    const out = await handler({ operation: 'delete', email: 'u@t.com', contactId: 'people/c1' });

    expect(sent().resourceName).toBe('people/c1');
    expect(out.text).toContain('Contact deleted');
    expect(out.text).toContain('people/c1');
  });

  it('names what was actually removed, not what the caller typed', async () => {
    // ctx.params holds the pre-normalization value, so a caller who passed `c1` read
    // "Contact deleted: c1" while `people/c1` was deleted.
    mockCall.mockResolvedValue({});
    const out = await handler({ operation: 'delete', email: 'u@t.com', contactId: 'c1' });
    expect(out.text).toContain('Contact deleted: people/c1');
  });
});

/**
 * Google states the requirement on both search methods in the Discovery document this
 * server generates from: "Before searching, clients should send a warmup request with an
 * empty query to update the cache." Skipping it returns an empty result set, which reads
 * as "no such person" — a wrong answer with nothing to distinguish it from a right one.
 */
describe('search warmup', () => {
  it.each([
    ['search',      'people.searchContacts'],
    ['searchOther', 'otherContacts.search'],
  ])('%s warms the cache with an empty query before searching', async (operation, resource) => {
    mockCall.mockResolvedValue({ results: [] });
    await handler({ operation, email: 'u@t.com', query: 'dana' });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockCall.mock.calls[0][1]).toBe(resource);
    expect(mockCall.mock.calls[0][2].query).toBe('');
    expect(mockCall.mock.calls[1][2].query).toBe('dana');
  });

  it('warms once per account, not once per search', async () => {
    mockCall.mockResolvedValue({ results: [] });
    await handler({ operation: 'search', email: 'u@t.com', query: 'a' });
    await handler({ operation: 'search', email: 'u@t.com', query: 'b' });
    expect(mockCall).toHaveBeenCalledTimes(3);   // warmup + two searches
  });

  it('warms each account separately', async () => {
    // The cache is Google's and it is per user. Warming one account tells us nothing
    // about the next one.
    mockCall.mockResolvedValue({ results: [] });
    await handler({ operation: 'search', email: 'one@t.com', query: 'a' });
    await handler({ operation: 'search', email: 'two@t.com', query: 'a' });
    expect(mockCall).toHaveBeenCalledTimes(4);
  });

  it('retries the warmup after a failure instead of giving up for the process', async () => {
    // The cache recorded "attempted", not "warmed", so one transient 429 disabled warmup
    // for the life of the process. Every later search then ran cold, and a cold search
    // returns empty — the convincing wrong answer this mechanism exists to prevent.
    mockCall.mockReset();
    mockCall.mockRejectedValueOnce(new Error('429'));   // warmup 1 fails
    mockCall.mockResolvedValue({ results: [] });

    await handler({ operation: 'search', email: 'u@t.com', query: 'a' });
    await handler({ operation: 'search', email: 'u@t.com', query: 'b' });

    const warmups = mockCall.mock.calls.filter(c => c[2].query === '');
    expect(warmups).toHaveLength(2);
  });

  it('makes a concurrent search wait for the warmup already in flight', async () => {
    // Marking the key before awaiting let a second search past a warmup that had not
    // finished, so it was cold by construction.
    mockCall.mockReset();
    let releaseWarmup: (v: unknown) => void = () => {};
    mockCall.mockImplementationOnce(() => new Promise(res => { releaseWarmup = res; }));
    mockCall.mockResolvedValue({ results: [] });

    const both = Promise.all([
      handler({ operation: 'search', email: 'u@t.com', query: 'a' }),
      handler({ operation: 'search', email: 'u@t.com', query: 'b' }),
    ]);

    await new Promise(r => setImmediate(r));
    expect(mockCall).toHaveBeenCalledTimes(1);   // neither search has run yet

    releaseWarmup({});
    await both;
    expect(mockCall).toHaveBeenCalledTimes(3);   // one warmup, two searches
  });

  it('searches anyway when the warmup fails', async () => {
    // A warmup that 403s means the real search is about to 403 with a message worth
    // reading. Throwing here would replace it with one that is not.
    mockCall.mockRejectedValueOnce(new Error('warmup exploded'));
    mockCall.mockResolvedValue({ results: [] });
    await expect(handler({ operation: 'search', email: 'u@t.com', query: 'dana' })).resolves.toBeDefined();
    expect(mockCall.mock.calls[1][2].query).toBe('dana');
  });
});

describe('the four envelopes', () => {
  const person = {
    resourceName: 'people/c1',
    names: [{ displayName: 'Dana Whitfield' }],
    emailAddresses: [{ value: 'dana@example.com' }],
  };

  it.each([
    ['connections (list)',     { connections: [person] }],
    ['otherContacts (listOther)', { otherContacts: [person] }],
    ['people (listDirectory)', { people: [person] }],
    ['results (search)',       { results: [{ person }] }],
  ])('reads %s', (_label, data) => {
    const out = contactsPatch.formatList!(data, ctx('list'));
    expect(out.text).toContain('Dana Whitfield');
    expect(out.text).toContain('people/c1');
    expect(out.refs?.count).toBe(1);
  });

  it('says a search found nothing, and why it might not have', () => {
    const out = contactsPatch.formatList!({ results: [] }, ctx('search', { query: 'nna' }));
    expect(out.text).toContain('No contacts found');
    expect(out.text).toContain('prefix');
    expect(out.refs?.count).toBe(0);
  });
});

describe('parallel-array fields', () => {
  it('takes the entry Google FLAGGED primary, not the one that happens to be first', () => {
    // Google orders these arbitrarily and marks the one that counts. Taking [0] is a
    // coin flip over which address a reply would go to.
    const data = {
      connections: [{
        resourceName: 'people/c1',
        names: [{ displayName: 'Old Alias' }, { displayName: 'Dana Whitfield', metadata: { primary: true } }],
        emailAddresses: [
          { value: 'stale@example.com' },
          { value: 'dana@example.com', metadata: { primary: true } },
        ],
      }],
    };
    const out = contactsPatch.formatList!(data, ctx('list'));
    expect(out.text).toContain('Dana Whitfield');
    expect(out.text).toContain('dana@example.com');
    expect(out.text).not.toContain('stale@example.com');
  });

  it('names a person who has only an email address', () => {
    // The whole point of listOther is addresses nobody saved, so most of its rows have
    // no `names` at all. Rendering them blank throws away the only fact on offer.
    const out = contactsPatch.formatList!(
      { otherContacts: [{ resourceName: 'otherContacts/c9', emailAddresses: [{ value: 'ping@example.com' }] }] },
      ctx('listOther'),
    );
    expect(out.text).toContain('ping@example.com');
    expect(out.text).not.toContain('(no name)');
  });

  it('renders every address with its label, primary first', () => {
    const out = contactsPatch.formatDetail!({
      resourceName: 'people/c1',
      names: [{ displayName: 'Dana Whitfield' }],
      emailAddresses: [
        { value: 'home@example.com', formattedType: 'Home' },
        { value: 'work@example.com', formattedType: 'Work', metadata: { primary: true } },
      ],
      organizations: [{ name: 'Acme', title: 'Field Engineer' }],
      biographies: [{ value: 'Met at the 2026 offsite.' }],
    }, ctx('get'));

    expect(out.text).toContain('**Email:** work@example.com (work), home@example.com (home)');
    expect(out.text).toContain('**Organization:** Acme — Field Engineer');
    expect(out.text).toContain('Met at the 2026 offsite.');
    expect(out.refs?.contactId).toBe('people/c1');
  });

  it('keeps a birthday that has no year', () => {
    // Google stores the day alone when that is all it was given. Treating a year-less
    // date as a partial record and dropping it loses the field entirely.
    const out = contactsPatch.formatDetail!({
      resourceName: 'people/c1',
      names: [{ displayName: 'Dana' }],
      birthdays: [{ date: { month: 3, day: 4 } }],
    }, ctx('get'));
    expect(out.text).toContain('**Birthday:** 03-04');
  });

  it('zero-pads a dated birthday so it reads as a date', () => {
    // Live, an unpadded birthday came back as `1980-9-22` — readable to a human and
    // not a date to anything that parses it.
    const out = contactsPatch.formatDetail!({
      resourceName: 'people/c36',
      names: [{ displayName: 'Amanda' }],
      birthdays: [{ date: { year: 1980, month: 9, day: 22 } }],
    }, ctx('get'));
    expect(out.text).toContain('**Birthday:** 1980-09-22');
  });
});

describe('truncation', () => {
  it('puts the continuation token in the TEXT, not only in refs', async () => {
    // `refs` never reaches the model — server.ts returns result.text alone. A token
    // carried only in refs is a page the agent is told about in a channel it cannot
    // read, which is how tab ids were lost in #157.
    mockCall.mockResolvedValue({
      connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Dana' }] }],
      nextPageToken: 'CAEQAA',
      totalPeople: 431,
    });
    const out = await handler({ operation: 'list', email: 'u@t.com' });
    expect(out.text).toContain('CAEQAA');
    expect(out.text).toContain('pageToken');
    expect(out.text).toContain('1 of 431');
  });

  it('says nothing about more pages when there are none', () => {
    const out = contactsPatch.formatList!(
      { connections: [{ resourceName: 'people/c1', names: [{ displayName: 'Dana' }] }] },
      ctx('list'),
    );
    expect(out.text).not.toContain('pageToken');
  });
});
