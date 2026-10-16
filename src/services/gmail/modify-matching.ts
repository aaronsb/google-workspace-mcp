/**
 * Label changes over everything a query matches, with no ids in the conversation (ADR-310, #206).
 *
 * `previewModifyMatching` resolves the query to the full set of message ids, holds it
 * server-side under the preview token, and returns the exact count, a sample, and what the
 * change does to each message. `modifyMatching` applies the change to exactly that set, in
 * `batchModify` chunks, and reports how many it changed. The set is used once.
 *
 * Mail that starts matching after the preview is untouched: routing future mail is a
 * filter's job (filters.ts).
 */

import { call } from '../../google/client.js';
import { formatShortDate, truncate, type HandlerResponse } from '../../server/formatting/markdown.js';
import { requireString } from '../../server/handlers/validate.js';
import {
  PREVIEW_TTL_MS,
  checkPreviewToken,
  describeTokenFailure,
  mintPreviewToken,
} from '../../server/preview-gate.js';
import { MAX_SET_SIZE, heldSet, holdSet, releaseSet, setDigest } from '../../server/preview-sets.js';
import { hydrateMessages } from './hydrate.js';
import { describeLabelChanges, effectLine, labelIdErrors, labelNames, parseLabelIds, type LabelChange } from './labels.js';

const KIND = 'manage_email.modifyMatching';

/** Why the write is gated, for the refusal when no token is given. */
const GATED_BECAUSE = 'It changes every message a query matched, a set the caller never sees row by row';

/** `users.messages.batchModify` takes at most this many ids per call. */
const BATCH_LIMIT = 1000;
const PAGE_SIZE = 500;
const SAMPLE_SIZE = 5;

interface Request {
  query: string;
  change: LabelChange;
}

/** The query and the change a call describes. Throws a sentence naming what is wrong. */
function buildRequest(params: Record<string, unknown>): Request {
  const query = requireString(params, 'query').trim();
  const change: LabelChange = {};
  const add = parseLabelIds(params.addLabelIds);
  const remove = parseLabelIds(params.removeLabelIds);
  if (add) change.addLabelIds = add;
  if (remove) change.removeLabelIds = remove;
  if (!add && !remove) {
    throw new Error('Give at least one change: addLabelIds, or removeLabelIds (e.g. INBOX to archive, UNREAD to mark read).');
  }
  const both = (add ?? []).filter((id) => remove?.includes(id));
  if (both.length) throw new Error(`A label cannot be both added and removed: ${both.join(', ')}.`);
  return { query, change };
}

/** Every id the query matches, or the first MAX_SET_SIZE + 1 when there are more. */
async function resolveQuery(account: string, q: string): Promise<{ ids: string[]; over: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call('gmail', 'users.messages.list', {
      userId: 'me', q, maxResults: PAGE_SIZE, ...(pageToken ? { pageToken } : {}),
    }, { account }) as Record<string, unknown>;
    ids.push(...((page?.messages ?? []) as Array<{ id: string }>).map((m) => m.id));
    pageToken = typeof page?.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : undefined;
  } while (pageToken && ids.length <= MAX_SET_SIZE);
  return ids.length > MAX_SET_SIZE ? { ids: [], over: true } : { ids, over: false };
}

const plural = (n: number) => `${n.toLocaleString('en-US')} message${n === 1 ? '' : 's'}`;

function refused(text: string, refs: Record<string, unknown> = {}): HandlerResponse {
  return { text, refs: { ...refs, blocked: true } };
}

/** `previewModifyMatching` — count, sample and describe the change, and hold the set. */
export async function handlePreviewModifyMatching(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const { query, change } = buildRequest(params);
  const [names, resolved] = await Promise.all([labelNames(account), resolveQuery(account, query)]);
  const { ids } = resolved;

  const errors = labelIdErrors(change, names);
  if (resolved.over) {
    errors.push(`More than ${MAX_SET_SIZE.toLocaleString('en-US')} messages match, more than one preview holds. ` +
      'Narrow the query, for example with after: and before: dates, and preview each part.');
  }

  const sample = ids.length ? await hydrateMessages(ids.slice(0, SAMPLE_SIZE).map((id) => ({ id })), account) : [];
  const lines = [`## Preview: change every message matching \`${query}\``, ''];
  lines.push(resolved.over
    ? `**Matches:** more than ${plural(MAX_SET_SIZE)}.`
    : `**Matches:** ${ids.length === 0 ? 'none' : plural(ids.length)}.`);
  lines.push('**Each is:**', ...describeLabelChanges(change, names, 'now').map(effectLine));
  if (sample.length) {
    lines.push('', 'Most recent matches:');
    for (const m of sample) {
      lines.push(m.error
        ? `${String(m.id)} | ⚠ ${String(m.error)}`
        : `${String(m.id)} | ${truncate(String(m.from ?? ''), 30)} | ${truncate(String(m.subject ?? '(no subject)'), 50)} | ${formatShortDate(m.date)}`);
    }
  }
  // Gmail leaves spam and trash out of a search unless the query names them.
  const namesSpamOrTrash = /\bin:(trash|spam|anywhere)\b/i.test(query);
  lines.push('', (namesSpamOrTrash ? '' : 'Spam and trash are not included. ') +
    'Mail that starts matching after this preview is not changed; to route it as it arrives, preview a filter with `previewFilter`.');

  const refs: Record<string, unknown> = { query, matchCount: resolved.over ? undefined : ids.length };

  if (!errors.length && ids.length === 0) {
    lines.push('', 'Nothing matches, so there is nothing to change and no previewToken.');
    return { text: lines.join('\n'), refs };
  }
  if (errors.length) {
    lines.push('', '### Cannot apply this change', ...errors.map((e) => `- ${e}`), '',
      'No previewToken issued. Fix the parameters and preview again.');
    return { text: lines.join('\n'), refs: { ...refs, errors } };
  }

  const token = mintPreviewToken(KIND, account, { query, change, digest: setDigest(ids) });
  holdSet(token, account, ids);
  lines.push('', 'To apply it, call `modifyMatching` with the same parameters and previewToken:', `\`${token}\``,
    `Good for ${PREVIEW_TTL_MS / 60_000} minutes and once. It changes exactly the ${plural(ids.length)} counted here.`);
  return { text: lines.join('\n'), refs: { ...refs, previewToken: token } };
}

/** `modifyMatching` — apply the previewed change to exactly the previewed set. */
export async function handleModifyMatching(params: Record<string, unknown>, account: string): Promise<HandlerResponse> {
  const { query, change } = buildRequest(params);
  const token = params.previewToken;
  const ids = typeof token === 'string' ? heldSet(token.trim(), account) : undefined;

  if (!ids) {
    // No set to check against. A token that is absent, not ours, or for another operation
    // says so; anything else was a real preview whose set is gone.
    const check = checkPreviewToken(token, KIND, account, { query, change, digest: '' });
    if (!check.ok && (check.failure === 'missing' || check.failure === 'malformed' || check.failure === 'wrong-kind')) {
      return refused(`**Nothing changed.** ${describeTokenFailure(check, 'modifyMatching', 'previewModifyMatching', GATED_BECAUSE)}`);
    }
    return refused('**Nothing changed.** This preview is no longer held: it was applied already, expired after ' +
      `${PREVIEW_TTL_MS / 60_000} minutes, was displaced by newer previews, or the server restarted. ` +
      'Call `previewModifyMatching` with these parameters and pass the previewToken it returns.');
  }

  const check = checkPreviewToken(token, KIND, account, { query, change, digest: setDigest(ids) });
  if (!check.ok) {
    return refused(`**Nothing changed.** ${describeTokenFailure(check, 'modifyMatching', 'previewModifyMatching', GATED_BECAUSE)}`);
  }

  // Fetched before the set is released, so a failure here leaves the preview usable and
  // nothing changed, rather than a completed write reported as a failure.
  const names = await labelNames(account);

  // Used once, whatever happens next: a retry resolves the query again.
  releaseSet((token as string).trim());

  let changed = 0;
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    try {
      await call('gmail', 'users.messages.batchModify', { userId: 'me', ids: chunk, ...change }, { account });
    } catch (err) {
      // Thrown, so a queue with onError 'bail' stops here.
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(
        `modifyMatching stopped part way: changed ${changed} of ${ids.length} messages, then the batch starting at ` +
        `message ${i + 1} failed (${why}). The preview is used up. Preview again to finish; the query now resolves ` +
        'against the mailbox as it is, without any message deleted since.',
      );
    }
    changed += chunk.length;
  }

  return {
    text: [`Changed ${plural(changed)} matching \`${query}\`. Each was:`,
      ...describeLabelChanges(change, names, 'now').map((e) => `- ${e.text}`)].join('\n'),
    refs: { query, changed },
  };
}
