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
    const composed = date.month && date.day
      ? [date.year, date.month, date.day].filter(Boolean).join('-')
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
const warmed = new Set<string>();

function warmupFirst(resource: 'people.searchContacts' | 'otherContacts.search') {
  return async (params: Record<string, unknown>, ctx: PatchContext): Promise<Record<string, unknown>> => {
    const key = `${ctx.account}:${resource}`;
    if (warmed.has(key)) return params;
    warmed.add(key);
    try {
      await call('people', resource, { query: '', readMask: params.readMask }, { account: ctx.account });
    } catch {
      // The warmup is a cache hint, not a precondition. If it failed for a reason that
      // matters — no scope, no network — the real search is about to fail the same way
      // and say so properly. Failing here would replace that with a confusing one.
    }
    return params;
  };
}

/** Test seam: the warmup is per-process state, and a test must be able to reset it. */
export function resetWarmupCache(): void {
  warmed.clear();
}

export const contactsPatch: ServicePatch = {
  beforeExecute: {
    get: normalizeContactId,
    list: mapSortOrder,
    search: warmupFirst('people.searchContacts'),
    searchOther: warmupFirst('otherContacts.search'),
  },
  formatList: formatPersonList,
  formatDetail: formatPersonDetail,
};
