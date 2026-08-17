/**
 * Contacts patch — domain-specific hooks for the People API.
 *
 * The People API returns a Person as PARALLEL ARRAYS. A name is not a string, it is
 * `names: [{ displayName, metadata: { primary } }, ...]`; an email is not a string, it
 * is `emailAddresses: [...]`. Every field works this way, one array per field, each
 * entry carrying its own metadata, and the entry that counts is flagged rather than
 * ordered. Handed to the generic formatter this renders as a person with no name and
 * no address — the same failure mode as a Docs read that returned metadata and no text.
 *
 * The second reshaping job is the envelope. Six read operations, four different keys
 * for "the people you asked for":
 *
 *   people.connections.list        -> { connections: [Person] }
 *   otherContacts.list             -> { otherContacts: [Person] }
 *   people.*DirectoryPeople        -> { people: [Person] }
 *   *.search                       -> { results: [{ person: Person }] }
 *
 * The agent picks an operation; it should not then have to know which of four shapes
 * came back.
 */

import { call } from '../../google/client.js';
import type { ServicePatch, PatchContext } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

// --- Person field access ---

type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec {
  return value && typeof value === 'object' ? (value as Rec) : {};
}

function asArray(value: unknown): Rec[] {
  return Array.isArray(value) ? value.map(asRec) : [];
}

/**
 * The entries of one Person field, primary first.
 *
 * Google flags the entry that counts with `metadata.primary` rather than putting it
 * first, so taking `[0]` picks an arbitrary one. On an account with a work address and
 * a personal one that is a coin flip over which address a reply goes to.
 */
function entries(person: Rec, field: string): Rec[] {
  const all = asArray(person[field]);
  const primary = all.filter((e) => asRec(e.metadata).primary === true);
  const rest = all.filter((e) => asRec(e.metadata).primary !== true);
  return [...primary, ...rest];
}

/** The primary value of a field, or '' when the field is absent. */
function primaryValue(person: Rec, field: string, key = 'value'): string {
  const first = entries(person, field)[0];
  const value = first?.[key];
  return typeof value === 'string' ? value : '';
}

/** Every value of a field, each labelled with its type ("work", "home", ...). */
function labelledValues(person: Rec, field: string, key = 'value'): string {
  return entries(person, field)
    .map((e) => {
      const value = e[key];
      if (typeof value !== 'string' || !value) return '';
      const label = typeof e.formattedType === 'string' ? e.formattedType : '';
      return label ? `${value} (${label.toLowerCase()})` : value;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * A display name, falling back through what the API actually returns.
 *
 * `displayName` is absent on a person who has only an email address — which is the
 * common case for `listOther`, where the whole point is addresses nobody ever saved.
 * Rendering those as blank rows loses the only fact the operation had to offer.
 */
function displayName(person: Rec): string {
  const name = primaryValue(person, 'names', 'displayName');
  if (name) return name;
  const email = primaryValue(person, 'emailAddresses');
  if (email) return email;
  const phone = primaryValue(person, 'phoneNumbers');
  return phone || '(no name)';
}

/** "Acme — Field Engineer", or whichever half exists. */
function organization(person: Rec): string {
  const org = entries(person, 'organizations')[0];
  if (!org) return '';
  const name = typeof org.name === 'string' ? org.name : '';
  const title = typeof org.title === 'string' ? org.title : '';
  return [name, title].filter(Boolean).join(' — ');
}

function personId(person: Rec): string {
  return typeof person.resourceName === 'string' ? person.resourceName : '';
}

// --- Envelope ---

/** The people in a response, whichever of the four keys this operation used. */
function peopleFrom(data: unknown): Rec[] {
  const raw = asRec(data);
  for (const key of ['connections', 'otherContacts', 'people']) {
    if (Array.isArray(raw[key])) return asArray(raw[key]);
  }
  // Search responses wrap each hit: { results: [{ person: {...} }] }
  if (Array.isArray(raw.results)) return asArray(raw.results).map((r) => asRec(r.person));
  return [];
}

/** The total Google reported, under whichever name it used for this operation. */
function totalFrom(data: unknown): number | undefined {
  const raw = asRec(data);
  for (const key of ['totalPeople', 'totalItems', 'totalSize']) {
    if (typeof raw[key] === 'number') return raw[key] as number;
  }
  return undefined;
}

// --- Formatters ---

function formatPersonList(data: unknown, ctx: PatchContext): HandlerResponse {
  const people = peopleFrom(data);
  const raw = asRec(data);
  const nextPageToken = typeof raw.nextPageToken === 'string' ? raw.nextPageToken : '';

  if (people.length === 0) {
    const hint = ctx.operation.startsWith('search')
      ? ` No match for "${String(ctx.params.query ?? '')}". Matching is by prefix, so a fragment from the middle of a name finds nothing.`
      : '';
    return { text: `No contacts found.${hint}`, refs: { count: 0 } };
  }

  const total = totalFrom(data);
  const heading = total !== undefined && total > people.length
    ? `## Contacts (${people.length} of ${total})`
    : `## Contacts (${people.length})`;

  const rows = people.map((p) => [
    personId(p),
    displayName(p),
    primaryValue(p, 'emailAddresses'),
    primaryValue(p, 'phoneNumbers'),
    organization(p),
  ].filter(Boolean).join(' | '));

  const parts = [heading, '', ...rows];

  // Saying nothing here would present a truncated list as the whole list — the caller
  // has no other way to learn the page ended early.
  if (nextPageToken) {
    parts.push('', `More to come. Call \`${ctx.operation}\` again with pageToken: ${nextPageToken}`);
  }

  return {
    text: parts.join('\n'),
    refs: {
      count: people.length,
      ids: people.map(personId),
      ...(nextPageToken ? { nextPageToken } : {}),
    },
  };
}

function formatPersonDetail(data: unknown): HandlerResponse {
  const person = asRec(data);
  const id = personId(person);
  const parts: string[] = [`## ${displayName(person)}`, '', id];

  const field = (label: string, value: string): void => {
    if (value) parts.push(`**${label}:** ${value}`);
  };

  parts.push('');
  field('Email', labelledValues(person, 'emailAddresses'));
  field('Phone', labelledValues(person, 'phoneNumbers'));
  field('Organization', organization(person));
  field('Address', labelledValues(person, 'addresses', 'formattedValue'));
  field('Nickname', primaryValue(person, 'nicknames'));
  field('Links', entries(person, 'urls').map((u) => String(u.value ?? '')).filter(Boolean).join(', '));
  field('Relations', entries(person, 'relations')
    .map((r) => {
      const who = String(r.person ?? '');
      const how = String(r.formattedType ?? '');
      return who ? (how ? `${who} (${how.toLowerCase()})` : who) : '';
    })
    .filter(Boolean)
    .join(', '));

  const birthday = entries(person, 'birthdays')[0];
  if (birthday) {
    const date = asRec(birthday.date);
    const text = typeof birthday.text === 'string' ? birthday.text : '';
    // A birthday with no year is normal — Google stores the day alone when that is all
    // it was given, so a year-less date is data, not a partial record to discard.
    const pad = (n: unknown): string => String(n).padStart(2, '0');
    const composed = date.month && date.day
      ? [date.year, pad(date.month), pad(date.day)].filter(Boolean).join('-')
      : text;
    field('Birthday', String(composed ?? ''));
  }

  const notes = primaryValue(person, 'biographies');
  if (notes) parts.push('', '### Notes', '', notes);

  return { text: parts.join('\n'), refs: { id, contactId: id } };
}

// --- Request shaping ---

/**
 * Accept a person id with or without its `people/` prefix.
 *
 * Every operation prints ids in full, so the prefix is normally present; a caller that
 * copied only the opaque half gets the record rather than a 404 that reads like the
 * person does not exist.
 */
function normalizeContactId(params: Record<string, unknown>): Record<string, unknown> {
  const raw = params.resourceName;
  if (typeof raw !== 'string') return params;
  const trimmed = raw.trim();
  return { ...params, resourceName: trimmed.startsWith('people/') ? trimmed : `people/${trimmed}` };
}

/**
 * Google's sort values are LAST_MODIFIED_DESCENDING and friends. The manifest advertises
 * `firstName` / `lastName` / `lastModified` and this maps them, so the agent does not
 * carry an API constant it can only get subtly wrong.
 */
export const SORT_ORDERS: Record<string, string> = {
  firstName: 'FIRST_NAME_ASCENDING',
  lastName: 'LAST_NAME_ASCENDING',
  lastModified: 'LAST_MODIFIED_DESCENDING',
};

function mapSortOrder(params: Record<string, unknown>): Record<string, unknown> {
  const raw = params.sortOrder;
  if (typeof raw !== 'string') return params;
  const mapped = SORT_ORDERS[raw];
  if (!mapped) {
    throw new Error(
      `sortOrder must be one of ${Object.keys(SORT_ORDERS).join(', ')}, got '${raw}'.`,
    );
  }
  return { ...params, sortOrder: mapped };
}

/**
 * Turn the flat parameters the schema advertises into the Person body Google wants.
 *
 * This is the write half of the same shape problem the formatters solve for reads. A
 * contact's name is `names: [{ givenName, familyName }]`, and anything this server sends
 * that Google does not recognise as a query parameter lands in the request body verbatim
 * — so a flat `name` is accepted, ignored, and returns 200 with a nameless contact. The
 * failure has no error in it anywhere.
 */
const WRITABLE = ['name', 'contactEmail', 'phone', 'company', 'jobTitle', 'notes'] as const;

/** Which Person field each flat parameter writes to. company and jobTitle share one. */
const PERSON_FIELD: Record<string, string> = {
  name: 'names',
  contactEmail: 'emailAddresses',
  phone: 'phoneNumbers',
  company: 'organizations',
  jobTitle: 'organizations',
  notes: 'biographies',
};

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * Organization subfields Google will RETURN but not ACCEPT.
 *
 * Measured, on both createContact and updateContact: an `organizations` entry carrying
 * `startDate` or `endDate` is answered with `500 Internal error encountered`. Every other
 * subfield probed — department, type, jobDescription, symbol, domain, location,
 * phoneticName, costCenter, current — round-trips fine.
 *
 * This is Google's bug, and it puts an edit that carries one of these fields between two
 * bad outcomes: send it and the write fails with a 500 that says nothing about why, or
 * drop it and the contact quietly loses an employment date nobody asked to change.
 */
const UNWRITABLE_ORG_FIELDS = ['startDate', 'endDate'] as const;

/**
 * Stop before the write rather than after, and say what to do about it.
 *
 * The alternative is a bare `500 Internal error encountered` arriving from an operation
 * that only changed a job title, which is not something a caller can act on.
 */
function refuseUnwritableOrgFields(orgs: Rec[]): void {
  const found = [...new Set(orgs.flatMap(o => UNWRITABLE_ORG_FIELDS.filter(f => o[f] !== undefined)))];
  if (found.length === 0) return;

  throw new Error(
    `This contact's organization record has ${found.join(' and ')}, which Google's People API ` +
    `returns on read and rejects on write with a 500. Changing 'company' or 'jobTitle' would have to ` +
    `send ${found.length > 1 ? 'those fields' : 'that field'} back and fail, or drop ${found.length > 1 ? 'them' : 'it'} ` +
    `and lose employment history nobody asked to change — so this stops instead. ` +
    `Every other field on this contact updates normally. To change the job title, edit it in Google ` +
    `Contacts directly, or clear the employment dates there first.`,
  );
}

/** A copy of a Person field entry without the metadata Google owns and writes itself. */
function withoutMetadata(entry: Rec): Rec {
  const { metadata: _ignored, ...rest } = entry;
  return { ...rest };
}

/**
 * Build the Person fields from the flat parameters, and report which Person fields the
 * caller touched.
 *
 * A parameter that is PRESENT but empty is a deliberate clear: the field is reported as
 * touched and gets no entry, which on `update` is how Google is told to empty it. A
 * parameter that is absent is not reported, so `update` never names it and never
 * disturbs it.
 *
 * `existingOrg` matters because `company` and `jobTitle` write to the SAME Person field.
 * Setting only the title would otherwise replace the whole organization entry and drop
 * the employer — a data loss with no error, inside a single field, from a parameter that
 * never mentioned the employer.
 */
/**
 * Exported for batch mode (ADR-308): a batch item carries the same flat fields as a
 * single create or update, and gets converted the same way. Without this, batch would
 * demand the raw People API shape — parallel arrays of objects — which is precisely what
 * manage_contacts exists to hide, and Google rejects the flat form with a 400.
 */
export function buildPerson(
  params: Record<string, unknown>,
  existingOrgs: Rec[] = [],
): { person: Record<string, unknown>; touched: Set<string> } {
  const person: Record<string, unknown> = {};
  const touched = new Set<string>();

  for (const key of WRITABLE) {
    const value = params[key];
    if (value === undefined) continue;

    // A non-string here is the worst input this operation can take, because the two
    // halves of an update are derived from different facts: `touched` from whether the
    // parameter ARRIVED, the body from whether it is a usable string. A number reaching
    // `phone` would name phoneNumbers in updatePersonFields and put nothing in the body
    // — which is precisely how Google is told to DELETE the number. The caller asked to
    // set a phone number, the contact loses the one it had, and the response says
    // "Contact updated."
    //
    // The MCP handler does not validate against inputSchema, so nothing upstream stops
    // this. Refusing matches mapSortOrder, which refuses for the same reason.
    if (typeof value !== 'string') {
      throw new Error(
        `${key} must be a string, got ${Array.isArray(value) ? 'an array' : typeof value}. ` +
        `An empty string clears the field; anything else is stored as written.`,
      );
    }
    touched.add(PERSON_FIELD[key]);
  }

  const name = trimmed(params.name);
  if (name) {
    // Google derives displayName itself; it needs the parts. One word is a given name —
    // guessing a family name from it would invent data.
    const parts = name.split(/\s+/);
    person.names = [parts.length === 1
      ? { givenName: parts[0] }
      : { givenName: parts[0], familyName: parts.slice(1).join(' ') }];
  }

  const contactEmail = trimmed(params.contactEmail);
  if (contactEmail) person.emailAddresses = [{ value: contactEmail }];

  const phone = trimmed(params.phone);
  if (phone) person.phoneNumbers = [{ value: phone }];

  // `company` and `jobTitle` are two parameters over ONE Person field, so writing either
  // rewrites the whole `organizations` array. An earlier version rebuilt that array as
  // `{name, title}` and nothing else, which silently discarded `department`, `type` and
  // `startDate` — fields the read half already had in hand — and dropped every entry
  // after the first. Correcting a job title erased an employment record, and the
  // confirmation looked right because it only ever renders name and title.
  //
  // So the existing entries are carried through and only the two named keys are
  // overwritten. `metadata` is dropped because Google populates it and rejects nothing
  // for its absence.
  if (params.company !== undefined || params.jobTitle !== undefined) {
    refuseUnwritableOrgFields(existingOrgs);
    const [primary = {}, ...others] = existingOrgs;
    const merged = withoutMetadata(primary);

    if (params.company !== undefined) {
      const company = trimmed(params.company);
      if (company) merged.name = company; else delete merged.name;
    }
    if (params.jobTitle !== undefined) {
      const jobTitle = trimmed(params.jobTitle);
      if (jobTitle) merged.title = jobTitle; else delete merged.title;
    }

    const all = [merged, ...others.map(withoutMetadata)].filter(o => Object.keys(o).length > 0);
    if (all.length > 0) person.organizations = all;
  }

  const notes = trimmed(params.notes);
  if (notes) person.biographies = [{ value: notes, contentType: 'TEXT_PLAIN' }];

  return { person, touched };
}

function personBody(params: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...params };
  for (const key of WRITABLE) delete rest[key];

  const { person } = buildPerson(params);

  // An empty Person is a valid request and a useless contact: Google answers 200 with a
  // record carrying nothing but an id. Refusing is the only way the caller finds out.
  if (Object.keys(person).length === 0) {
    throw new Error(
      'create needs at least one of: name, contactEmail, phone, company, jobTitle, notes. ' +
      'Google would accept an empty contact and return one with no name and no address.',
    );
  }

  return { ...rest, ...person };
}

/**
 * `update` is a read-modify-write, for two reasons that are not optional.
 *
 * Google requires the contact's current `etag` in the body and rejects the call without
 * it — that is the API refusing to let one caller silently overwrite another's edit.
 *
 * And `updatePersonFields` REPLACES every entry in each field it names. Naming a field
 * with nothing in the body clears it. So the list is derived from what the caller
 * actually passed, never declared: a static list would wipe a phone number every time
 * someone corrected a job title.
 */
async function updateContact(
  params: Record<string, unknown>,
  ctx: PatchContext,
): Promise<Record<string, unknown>> {
  const withId = normalizeContactId(params);
  const resourceName = String(withId.resourceName);

  const current = asRec(await call('people', 'people.get', {
    resourceName,
    personFields: 'names,emailAddresses,phoneNumbers,organizations,biographies,metadata',
  }, { account: ctx.account }));

  const { person, touched } = buildPerson(params, entries(current, 'organizations'));

  if (touched.size === 0) {
    throw new Error(
      'update needs at least one of: name, contactEmail, phone, company, jobTitle, notes. ' +
      'Pass an empty string to clear a field.',
    );
  }

  const rest = { ...withId };
  for (const key of WRITABLE) delete rest[key];

  return {
    ...rest,
    ...person,
    etag: current.etag,
    updatePersonFields: [...touched].join(','),
  };
}

/**
 * Both search operations require a WARMUP call before they return anything.
 *
 * This is not folklore — Google says it in the Discovery document this server generates
 * from, on `people.searchContacts` and on `otherContacts.search` alike: "Before
 * searching, clients should send a warmup request with an empty query to update the
 * cache." A first search without it comes back empty, which reads exactly like "you have
 * no contact by that name" and is the most convincing wrong answer this tool could give.
 *
 * Once per account per operation is enough for the life of the process; the cache is
 * Google's, and paying for a second round trip on every search would be worse than the
 * problem.
 */
const warming = new Map<string, Promise<void>>();

function warmupFirst(resource: 'people.searchContacts' | 'otherContacts.search') {
  return async (params: Record<string, unknown>, ctx: PatchContext): Promise<Record<string, unknown>> => {
    const key = `${ctx.account}:${resource}`;

    // The in-flight promise is cached, not a "we tried" flag. Recording the attempt up
    // front made a single transient 429 permanent: warmup was skipped for the rest of
    // the process, every later search ran cold, and a cold search returns EMPTY — which
    // renders as "no match", the convincing wrong answer this whole mechanism exists to
    // prevent. It also let a second concurrent search past a warmup still in flight.
    let inFlight = warming.get(key);
    if (!inFlight) {
      inFlight = call('people', resource, { query: '', readMask: params.readMask }, { account: ctx.account })
        .then(
          () => {},
          () => {
            // A cache hint, not a precondition: forget the failure so the next search
            // retries. If it failed for a reason that matters — no scope, no network —
            // the real search is about to fail the same way and say so properly.
            warming.delete(key);
          },
        );
      warming.set(key, inFlight);
    }
    await inFlight;
    return params;
  };
}

/** Test seam: the warmup is per-process state, and a test must be able to reset it. */
export function resetWarmupCache(): void {
  warming.clear();
}

/**
 * Confirm a write by saying what was written and where it lives.
 *
 * The new id is the part that matters: it is the only handle on the contact just made,
 * and `get`, and any future update, need it. Google returns it and the generic action
 * formatter would drop it.
 */
function formatContactAction(data: unknown, ctx: PatchContext): HandlerResponse {
  // deleteContact returns an empty body: there is no person left to render, and the id
  // the caller passed is the only thing left to name.
  if (ctx.operation === 'delete') {
    // ctx.params holds what the CALLER passed, before normalization — so a caller who
    // wrote `c36` would read "Contact deleted: c36" while `people/c36` was deleted. The
    // receipt has to name the thing that was actually removed.
    const id = String(normalizeContactId({ resourceName: ctx.params.contactId }).resourceName ?? '');
    return { text: `Contact deleted: ${id}`, refs: { contactId: id, deleted: true } };
  }

  const person = asRec(data);
  const id = personId(person);
  const detail = formatPersonDetail(person);
  return {
    text: `Contact ${ctx.operation === 'create' ? 'created' : 'updated'}.\n\n${detail.text}`,
    refs: { id, contactId: id },
  };
}

export const contactsPatch: ServicePatch = {
  beforeExecute: {
    get: normalizeContactId,
    list: mapSortOrder,
    create: personBody,
    update: updateContact,
    delete: normalizeContactId,
    search: warmupFirst('people.searchContacts'),
    searchOther: warmupFirst('otherContacts.search'),
  },
  formatList: formatPersonList,
  formatDetail: formatPersonDetail,
  formatAction: formatContactAction,
};
