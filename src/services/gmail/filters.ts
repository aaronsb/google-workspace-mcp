/**
 * Gmail filters — routing applied to mail as it arrives. ADR-309, #202.
 *
 * A filter is a standing-effect write: it keeps acting after the call, on messages the
 * call never saw. So the lifecycle is gated. `previewFilter` evaluates a filter against the
 * mail already there and mints a token for that exact filter; `createFilter` and
 * `updateFilter` refuse without it. Every action Gmail supports stays available, and the
 * preview is where a dangerous one (trash, forward) is explained.
 *
 * Gmail has no `filters.update`. `updateFilter` creates the replacement first and deletes
 * the original after, so a failure part-way leaves two filters, never none.
 *
 * Parameters are flat, like every other operation on this tool: criteria are `match*`,
 * actions are `addLabelIds`, `removeLabelIds` and `forwardTo`.
 */

import { call } from '../../google/client.js';
import { GoogleApiError } from '../../google/errors.js';
import { formatShortDate, truncate, type HandlerResponse } from '../../server/formatting/markdown.js';
import { requireString } from '../../server/handlers/validate.js';
import {
  PREVIEW_TTL_MS,
  canonicalJson,
  checkPreviewToken,
  describeTokenFailure,
  mintPreviewToken,
} from '../../server/preview-gate.js';
import { hydrateMessages } from './hydrate.js';
import { describeLabelChanges, effectLine, labelIdErrors, labelNames, parseLabelIds, type Effect } from './labels.js';

// --- The filter, in one canonical shape ---

export interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: 'larger' | 'smaller';
}

export interface FilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

/** Field names match Gmail's `Filter` resource, so a spec is also the request body. */
export interface FilterSpec {
  criteria: FilterCriteria;
  action: FilterAction;
}

/** A filter as Google returns it, before normalizing. */
type RawFilter = { criteria?: Record<string, unknown>; action?: Record<string, unknown> };

interface StoredFilter extends FilterSpec {
  id: string;
}

// Named for the operation a token authorizes, so a token offered to its sibling says which it is for.
const CREATE_KIND = 'manage_email.createFilter';
const UPDATE_KIND = 'manage_email.updateFilter';

/** Gmail's per-user limit. */
const FILTER_LIMIT = 1000;

/** Gmail stores a filter's size criterion as an int32. */
const MAX_SIZE = 2 ** 31 - 1;

/** How many matches the preview walks before it settles for "at least". */
const COUNT_CAP = 2000;
const SAMPLE_SIZE = 5;

/** Tool param → criteria field, for the string criteria. */
const STRING_CRITERIA: Record<string, keyof FilterCriteria> = {
  matchFrom: 'from',
  matchTo: 'to',
  matchSubject: 'subject',
  matchQuery: 'query',
  matchNegatedQuery: 'negatedQuery',
};

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

function bool(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * A boolean param, strictly. A value read as false drops a criterion and widens the
 * filter, so anything that is not plainly true or false is refused rather than guessed.
 */
function paramBool(value: unknown, name: string): boolean {
  if (value === undefined || value === null || value === '' || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new Error(`${name} must be true or false, not '${String(value)}'.`);
}

/**
 * Reduce any filter, from our params or from Google, to one canonical spec, so two
 * filters that do the same thing compare equal and a token minted over one matches the
 * other. Empty strings, false booleans and empty label lists are absent.
 */
export function normalizeSpec(raw: RawFilter): FilterSpec {
  const c = raw.criteria ?? {};
  const a = raw.action ?? {};
  const criteria: FilterCriteria = {};
  for (const field of ['from', 'to', 'subject', 'query', 'negatedQuery'] as const) {
    const v = str(c[field]);
    if (v) criteria[field] = v;
  }
  if (bool(c.hasAttachment)) criteria.hasAttachment = true;
  if (bool(c.excludeChats)) criteria.excludeChats = true;
  const size = Number(c.size);
  const comparison = str(c.sizeComparison);
  if (size > 0 && (comparison === 'larger' || comparison === 'smaller')) {
    criteria.size = size;
    criteria.sizeComparison = comparison;
  }

  const action: FilterAction = {};
  const add = parseLabelIds(a.addLabelIds);
  const remove = parseLabelIds(a.removeLabelIds);
  const forward = str(a.forward)?.toLowerCase();
  if (add) action.addLabelIds = add;
  if (remove) action.removeLabelIds = remove;
  if (forward) action.forward = forward;
  return { criteria, action };
}

/** Build and validate the filter a call describes. Throws a sentence naming what is missing. */
export function buildFilterSpec(params: Record<string, unknown>): FilterSpec {
  const criteria: Record<string, unknown> = {};
  for (const [param, field] of Object.entries(STRING_CRITERIA)) criteria[field] = params[param];
  criteria.hasAttachment = paramBool(params.matchHasAttachment, 'matchHasAttachment');
  criteria.excludeChats = paramBool(params.matchExcludeChats, 'matchExcludeChats');

  const size = params.matchSize;
  const comparison = str(params.matchSizeComparison);
  if (comparison && comparison !== 'larger' && comparison !== 'smaller') {
    throw new Error(`matchSizeComparison must be 'larger' or 'smaller', not '${comparison}'.`);
  }
  const hasSize = size !== undefined && size !== null && size !== '';
  if (hasSize !== Boolean(comparison)) {
    throw new Error('matchSize and matchSizeComparison go together: a size in bytes, and whether matches are larger or smaller.');
  }
  const bytes = Number(size);
  if (hasSize && !(Number.isInteger(bytes) && bytes > 0 && bytes <= MAX_SIZE)) {
    throw new Error(`matchSize must be a whole number of bytes from 1 to ${MAX_SIZE}, not '${String(size)}'.`);
  }
  criteria.size = hasSize ? bytes : undefined;
  criteria.sizeComparison = comparison;

  const spec = normalizeSpec({
    criteria,
    action: { addLabelIds: params.addLabelIds, removeLabelIds: params.removeLabelIds, forward: params.forwardTo },
  });

  const { excludeChats: _ignored, ...matching } = spec.criteria;
  if (Object.keys(matching).length === 0) {
    throw new Error(
      'A filter needs at least one criterion: matchFrom, matchTo, matchSubject, matchQuery, ' +
      'matchNegatedQuery, matchHasAttachment, or matchSize with matchSizeComparison.',
    );
  }
  if (Object.keys(spec.action).length === 0) {
    throw new Error(
      'A filter needs at least one action: addLabelIds, removeLabelIds (e.g. INBOX to skip the inbox), or forwardTo.',
    );
  }
  return spec;
}

/** The Gmail search a filter's criteria amount to. Filters and search share one syntax. */
export function criteriaToQuery(c: FilterCriteria): string {
  const parts: string[] = [];
  if (c.from) parts.push(`from:(${c.from})`);
  if (c.to) parts.push(`to:(${c.to})`);
  if (c.subject) parts.push(`subject:(${c.subject})`);
  if (c.query) parts.push(`(${c.query})`);
  if (c.negatedQuery) parts.push(`-(${c.negatedQuery})`);
  if (c.hasAttachment) parts.push('has:attachment');
  if (c.size && c.sizeComparison) parts.push(`${c.sizeComparison}:${c.size}`);
  if (c.excludeChats) parts.push('-in:chats');
  return parts.join(' ');
}

/** The tool params that describe this filter, for recreating or editing it. */
export function specToParams(spec: FilterSpec): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [param, field] of Object.entries(STRING_CRITERIA)) {
    const v = spec.criteria[field];
    if (v) out[param] = v as string;
  }
  if (spec.criteria.hasAttachment) out.matchHasAttachment = true;
  if (spec.criteria.excludeChats) out.matchExcludeChats = true;
  if (spec.criteria.size) {
    out.matchSize = spec.criteria.size;
    out.matchSizeComparison = spec.criteria.sizeComparison!;
  }
  if (spec.action.addLabelIds) out.addLabelIds = spec.action.addLabelIds.join(',');
  if (spec.action.removeLabelIds) out.removeLabelIds = spec.action.removeLabelIds.join(',');
  if (spec.action.forward) out.forwardTo = spec.action.forward;
  return out;
}

// --- What a filter does, in words ---

export function describeActions(action: FilterAction, names: Map<string, string>): Effect[] {
  const effects = describeLabelChanges(action, names, 'arrival');
  if (action.forward) {
    effects.push({
      text: `forwarded in full to ${action.forward}`,
      detail: 'every time, with no further prompt; whoever reads that address reads every match',
      warn: true,
    });
  }
  return effects;
}

function effectLines(action: FilterAction, labelNames: Map<string, string>): string[] {
  return describeActions(action, labelNames).map(effectLine);
}

function summarize(spec: FilterSpec, labelNames: Map<string, string>): string {
  return describeActions(spec.action, labelNames).map((e) => e.text).join('; ');
}

function describeFilter(spec: FilterSpec, labelNames: Map<string, string>): string[] {
  return [`**Criteria:** \`${criteriaToQuery(spec.criteria)}\``, '**Actions:** matching mail is', ...effectLines(spec.action, labelNames)];
}

// --- Reading what the account has ---

async function listFilters(account: string): Promise<StoredFilter[]> {
  const raw = await call('gmail', 'users.settings.filters.list', { userId: 'me' }, { account }) as Record<string, unknown>;
  const filters = (raw?.filter ?? []) as Array<Record<string, unknown>>;
  return filters.map((f) => ({ id: String(f.id ?? ''), ...normalizeSpec(f as RawFilter) }));
}

async function getStoredFilter(account: string, id: string): Promise<StoredFilter | undefined> {
  try {
    const f = await call('gmail', 'users.settings.filters.get', { userId: 'me', id }, { account }) as Record<string, unknown>;
    return { id: String(f.id ?? id), ...normalizeSpec(f as RawFilter) };
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 404) return undefined;
    throw err;
  }
}

async function forwardingAddresses(account: string): Promise<Array<{ forwardingEmail: string; verificationStatus?: string }>> {
  const raw = await call('gmail', 'users.settings.forwardingAddresses.list', { userId: 'me' }, { account }) as Record<string, unknown>;
  return (raw?.forwardingAddresses ?? []) as Array<{ forwardingEmail: string; verificationStatus?: string }>;
}

const same = (a: FilterSpec, b: FilterSpec) => canonicalJson(a) === canonicalJson(b);
const sameCriteria = (a: FilterSpec, b: FilterSpec) => canonicalJson(a.criteria) === canonicalJson(b.criteria);
const asSpec = (f: StoredFilter): FilterSpec => ({ criteria: f.criteria, action: f.action });

interface MatchCount {
  count: number;
  /** True when the walk reached the end; otherwise `count` is a floor. */
  exact: boolean;
  estimate?: number;
  sampleIds: string[];
}

/** Walk ids-only pages of the filter's query, up to COUNT_CAP. */
async function countMatches(account: string, q: string): Promise<MatchCount> {
  let count = 0;
  let estimate: number | undefined;
  let pageToken: string | undefined;
  const sampleIds: string[] = [];
  do {
    const page = await call('gmail', 'users.messages.list', {
      userId: 'me', q, maxResults: 500, ...(pageToken ? { pageToken } : {}),
    }, { account }) as Record<string, unknown>;
    const ids = ((page?.messages ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (estimate === undefined && typeof page?.resultSizeEstimate === 'number') estimate = page.resultSizeEstimate;
    count += ids.length;
    sampleIds.push(...ids.slice(0, SAMPLE_SIZE - sampleIds.length));
    pageToken = typeof page?.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
  } while (pageToken && count < COUNT_CAP);
  return { count, exact: !pageToken, estimate, sampleIds };
}

function refused(text: string, refs: Record<string, unknown> = {}): HandlerResponse {
  return { text, refs: { ...refs, blocked: true } };
}

// --- Operations ---

/** `filters` — every filter on the account, one line each. */
export async function handleListFilters(_params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const [filters, names] = await Promise.all([listFilters(account), labelNames(account)]);
  if (filters.length === 0) return { text: 'No filters on this account.', refs: { count: 0, filterIds: [] } };
  const rows = filters.map((f) => `${f.id} | ${truncate(criteriaToQuery(f.criteria), 70)} | ${summarize(f, names)}`);
  return {
    text: `## Filters (${filters.length} of ${FILTER_LIMIT.toLocaleString('en-US')})\n\n${rows.join('\n')}`,
    refs: { count: filters.length, filterId: filters[0].id, filterIds: filters.map((f) => f.id) },
  };
}

/** `getFilter` — one filter, in words, with the parameters that recreate or edit it. */
export async function handleGetFilter(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const id = requireString(params, 'filterId');
  const [filter, names] = await Promise.all([getStoredFilter(account, id), labelNames(account)]);
  if (!filter) return refused(`No filter ${id} on ${account}. List them with \`filters\`.`, { filterId: id });
  const recreate = specToParams(filter);
  return {
    text: [
      `## Filter ${id}`, '',
      ...describeFilter(filter, names), '',
      `**As parameters** (for previewFilter, with filterId to edit it): \`${JSON.stringify(recreate)}\``,
    ].join('\n'),
    refs: { filterId: id, query: criteriaToQuery(filter.criteria), params: recreate },
  };
}

/**
 * `previewFilter` — evaluate a filter without creating it, and mint the token the write
 * needs. With `filterId`, evaluates replacing that filter and mints an update token.
 *
 * Problems that would make the write fail or do nothing (an unknown label, an unverified
 * forwarding address, an exact duplicate) are errors and withhold the token. Consequences
 * worth a second look are shown, not refused.
 */
export async function handlePreviewFilter(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const spec = buildFilterSpec(params);
  const replacingId = str(params.filterId);
  const [filters, names, forwarding] = await Promise.all([
    listFilters(account),
    labelNames(account),
    spec.action.forward ? forwardingAddresses(account) : Promise.resolve([]),
  ]);

  const errors: string[] = [];
  const notes: string[] = [];

  const replacing = replacingId ? filters.find((f) => f.id === replacingId) : undefined;
  if (replacingId && !replacing) errors.push(`No filter ${replacingId} exists on this account. List them with \`filters\`.`);
  if (replacing && same(asSpec(replacing), spec)) errors.push(`Filter ${replacingId} already has exactly these criteria and actions; there is nothing to change.`);

  errors.push(...labelIdErrors(spec.action, names));

  if (spec.action.forward) {
    const address = forwarding.find((a) => a.forwardingEmail.toLowerCase() === spec.action.forward);
    if (!address) {
      errors.push(`${spec.action.forward} is not a forwarding address on this account. Gmail forwards only to ` +
        'addresses added and verified in Gmail settings, under Forwarding and POP/IMAP.');
    } else if (address.verificationStatus !== 'accepted') {
      errors.push(`${spec.action.forward} is a forwarding address but is not verified yet (${address.verificationStatus ?? 'unknown'}).`);
    }
  }

  const others = filters.filter((f) => f.id !== replacingId);
  const duplicate = others.find((f) => same(asSpec(f), spec));
  if (duplicate) errors.push(`Filter ${duplicate.id} already does exactly this.`);
  for (const f of others) {
    if (f !== duplicate && sameCriteria(f, spec)) {
      notes.push(`⚠ Filter ${f.id} has the same criteria and does: ${summarize(f, names)}. Both will apply to every match.`);
    }
  }
  if (filters.length >= FILTER_LIMIT) {
    errors.push(replacing
      ? `This account has ${filters.length} filters, Gmail's limit. An update creates the replacement before deleting ` +
        `the original, and Gmail refuses the 1,001st. Delete ${replacingId} first (deleteFilter returns its parameters), ` +
        'then preview and create the replacement.'
      : `This account has ${filters.length} filters, Gmail's limit.`);
  } else if (filters.length >= FILTER_LIMIT - 50) notes.push(`This account has ${filters.length} of Gmail's ${FILTER_LIMIT} filters.`);

  const query = criteriaToQuery(spec.criteria);
  const matches = await countMatches(account, query);
  const sample = matches.sampleIds.length ? await hydrateMessages(matches.sampleIds.map((id) => ({ id })), account) : [];

  const write = replacing ? 'updateFilter' : 'createFilter';
  const lines: string[] = [replacing ? `## Preview: replace filter ${replacingId}` : '## Preview: new filter', ''];
  lines.push(...describeFilter(spec, names), '');

  if (replacing) {
    lines.push(`**Replaces** filter ${replacingId}, which is:`, `- criteria \`${criteriaToQuery(replacing.criteria)}\``);
    lines.push(...describeActions(replacing.action, names).map((e) => `- ${e.text}`));
    lines.push(`Gmail has no in-place update: the replacement gets a new id, and ${replacingId} is deleted after it is created.`, '');
  }

  if (matches.exact) {
    lines.push(matches.count === 0
      ? '**Matches today:** none. A filter that matches nothing yet may be mistyped, or may be for mail that has not started arriving.'
      : `**Matches today:** ${matches.count} message${matches.count === 1 ? '' : 's'}.`);
  } else {
    const est = matches.estimate !== undefined ? ` Google estimates about ${matches.estimate}, which is an estimate.` : '';
    lines.push(`**Matches today:** at least ${matches.count}; counting stopped there.${est}`);
  }
  if (sample.length) {
    lines.push('', 'Most recent matches:');
    for (const m of sample) {
      lines.push(m.error
        ? `${String(m.id)} | ⚠ ${String(m.error)}`
        : `${String(m.id)} | ${truncate(String(m.from ?? ''), 30)} | ${truncate(String(m.subject ?? '(no subject)'), 50)} | ${formatShortDate(m.date)}`);
    }
  }
  if (matches.count > 0) {
    const relabel = spec.action.addLabelIds || spec.action.removeLabelIds;
    lines.push('', 'A filter acts only on mail that arrives after it exists; the messages counted above stay as they are (spam and trash were not counted).' +
      (relabel
        ? ` To give them the same label changes, call \`previewModifyMatching\` with query \`${query}\` and the same addLabelIds and removeLabelIds, then \`modifyMatching\` with its token.`
        : ''));
  }
  if (notes.length) lines.push('', ...notes);

  const refs: Record<string, unknown> = {
    query,
    matchCount: matches.count,
    matchCountExact: matches.exact,
    ...(matches.estimate !== undefined ? { resultSizeEstimate: matches.estimate } : {}),
    ...(replacingId ? { filterId: replacingId } : {}),
  };

  if (errors.length) {
    lines.push('', `### Cannot ${replacing ? 'replace' : 'create'} this filter`, ...errors.map((e) => `- ${e}`), '',
      'No previewToken issued. Fix the parameters and preview again.');
    return { text: lines.join('\n'), refs: { ...refs, errors } };
  }

  const token = replacing
    ? mintPreviewToken(UPDATE_KIND, account, { filterId: replacingId, before: asSpec(replacing), spec })
    : mintPreviewToken(CREATE_KIND, account, { spec });
  lines.push('', replacing
    ? `To apply this change, call \`${write}\` with filterId ${replacingId}, the same parameters, and previewToken:`
    : `To create it, call \`${write}\` with the same parameters and previewToken:`,
    `\`${token}\``,
    `Good for ${PREVIEW_TTL_MS / 60_000} minutes, for this account and exactly these parameters.`);
  return { text: lines.join('\n'), refs: { ...refs, previewToken: token } };
}

/** `createFilter` — create a filter its preview has already shown. */
export async function handleCreateFilter(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const spec = buildFilterSpec(params);
  const check = checkPreviewToken(params.previewToken, CREATE_KIND, account, { spec });
  if (!check.ok) return refused(`**Not created.** ${describeTokenFailure(check, 'createFilter', 'previewFilter')}`);

  const [filters, names] = await Promise.all([listFilters(account), labelNames(account)]);
  const duplicate = filters.find((f) => same(asSpec(f), spec));
  if (duplicate) return refused(`**Not created.** Filter ${duplicate.id} already does exactly this.`, { filterId: duplicate.id });

  const created = await call('gmail', 'users.settings.filters.create', { userId: 'me', ...spec }, { account }) as Record<string, unknown>;
  const id = String(created.id ?? '');
  return {
    text: [`Created filter **${id}**.`, '', ...describeFilter(spec, names), '',
      'It acts on mail arriving from now on; messages already in the mailbox are unchanged.'].join('\n'),
    refs: { filterId: id, created: true },
  };
}

/**
 * `updateFilter` — replace a filter with the one its preview showed.
 *
 * The token covers the filter being replaced as it was at preview time, so a filter that
 * changed in the meantime is not replaced on the strength of a preview of something else.
 */
export async function handleUpdateFilter(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const filterId = requireString(params, 'filterId');
  const spec = buildFilterSpec(params);
  const [current, filters, names] = await Promise.all([getStoredFilter(account, filterId), listFilters(account), labelNames(account)]);
  if (!current) {
    return refused(`**Not changed.** Filter ${filterId} no longer exists on ${account}. To make it fresh, preview without filterId and use createFilter.`, { filterId });
  }

  const check = checkPreviewToken(params.previewToken, UPDATE_KIND, account, { filterId, before: asSpec(current), spec });
  if (!check.ok) return refused(`**Not changed.** ${describeTokenFailure(check, 'updateFilter', 'previewFilter (with filterId)')}`, { filterId });

  const duplicate = filters.find((f) => f.id !== filterId && same(asSpec(f), spec));
  if (duplicate) return refused(`**Not changed.** Filter ${duplicate.id} already does exactly this.`, { filterId });

  const created = await call('gmail', 'users.settings.filters.create', { userId: 'me', ...spec }, { account }) as Record<string, unknown>;
  const newId = String(created.id ?? '');
  try {
    await call('gmail', 'users.settings.filters.delete', { userId: 'me', id: filterId }, { account });
  } catch (err) {
    // Already gone is the outcome the delete was for.
    if (!(err instanceof GoogleApiError && err.status === 404)) {
      // Half done is a failure, not a success with a caveat: thrown, so a queue with
      // onError 'bail' stops here instead of running on.
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(
        `updateFilter half done: created the replacement filter ${newId}, but could not delete the original ` +
        `${filterId} (${why}). Both are active now. Remove the original with deleteFilter filterId ${filterId}.`,
      );
    }
  }
  return {
    text: [`Replaced filter **${filterId}** with **${newId}**. Gmail has no in-place update, so the filter has a new id.`, '',
      ...describeFilter(spec, names), '',
      'It acts on mail arriving from now on; messages already in the mailbox are unchanged.'].join('\n'),
    refs: { filterId: newId, replacedFilterId: filterId, originalDeleted: true },
  };
}

/** `deleteFilter` — stop a filter, and return what it was so it can be put back. */
export async function handleDeleteFilter(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const filterId = requireString(params, 'filterId');
  const [filter, names] = await Promise.all([getStoredFilter(account, filterId), labelNames(account)]);
  if (!filter) return refused(`No filter ${filterId} on ${account}; nothing deleted. List them with \`filters\`.`, { filterId });

  await call('gmail', 'users.settings.filters.delete', { userId: 'me', id: filterId }, { account });
  const recreate = specToParams(filter);
  return {
    text: [`Deleted filter **${filterId}**. Mail it matched now arrives without its routing.`, '', 'It was:',
      ...describeFilter(filter, names), '',
      `To put it back, preview and create with: \`${JSON.stringify(recreate)}\``].join('\n'),
    refs: { filterId, deleted: true, params: recreate },
  };
}
