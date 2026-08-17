/**
 * docs-sync — translate a single JSON-mode mutation into a Google Docs
 * `batchUpdate` request, or reject it.
 *
 * Issue #79 / deferred portion of ADR-301. The scratchpad JSON-mode buffer
 * for a Doc lets agents do `json_set` on a typed path; this module turns
 * those intents into the discrete operations the Docs API requires
 * (`insertText`, `deleteContentRange`, `updateParagraphStyle`) — no full
 * JSON replace endpoint exists.
 *
 * Two supported path shapes, each addressed within a tab:
 *
 *  1. `$.tabs[T].documentTab.body.content[N].paragraph.elements[M].textRun.content`
 *     Text content change → `deleteContentRange(startIndex, endIndex)` +
 *     `insertText(text=newValue, location.index=startIndex)`. Watch the
 *     trailing-newline trap: a textRun whose content ends with `\n` includes
 *     the paragraph break in its range; deleting through it removes the
 *     paragraph. We delete `endIndex - 1` in that case to preserve the break.
 *     A `\n` in the new value is rejected — that's a structural edit dressed
 *     as a text change.
 *
 *  2. `$.tabs[T].documentTab.body.content[N].paragraph.paragraphStyle.<field>`
 *     Paragraph style change → `updateParagraphStyle` over the element's
 *     range with `fields: <field>`. We don't pre-validate the field name —
 *     the API rejects unknown fields cleanly and we surface its message.
 *
 * TABS (#155). The buffer is fetched with `includeTabsContent`, so content sits
 * under `tabs[].documentTab.body` and nested tabs under `childTabs` — a path may
 * therefore carry any depth of `tabs[T].childTabs[C]…` before `documentTab`. The
 * tab prefix is matched generically rather than by a fixed shape, and the tab's
 * `tabProperties.tabId` is carried onto every emitted request: Docs resolves an
 * omitted tabId to the FIRST tab, so a character index measured in tab three
 * would otherwise be applied to tab one. A path whose tab has no resolvable id
 * is rejected rather than written to whichever tab Google picks.
 *
 * The bare `$.body.…` shape still translates, without a tabId, for the response
 * shape that carries no tabs at all.
 *
 * Anything else (structural edits, table cells, list items, image
 * properties, root-level changes) is rejected with guidance to use markdown
 * mode + doc_create / doc_write for structural authoring.
 *
 * Optimistic concurrency: every translation includes
 * `writeControl.requiredRevisionId` = the revisionId captured at import time
 * (or after the previous successful sync). The Docs API rejects stale
 * writes — the agent gets a clean error rather than silently corrupting a
 * doc that's been edited by a collaborator since import.
 */

import { parsePath } from './json-path.js';

export type DocsSyncOp = 'set' | 'delete' | 'insert';

export interface DocsSyncIntent {
  op: DocsSyncOp;
  path: string;
  /** New value for `set` / `insert`; undefined for `delete`. */
  value?: unknown;
  /** Pre-mutation buffer JSON text (for looking up startIndex/endIndex/oldContent). */
  beforeJson: string;
}

/** Successful translation — body to POST to documents.batchUpdate. */
export interface DocsSyncRequest {
  body: {
    requests: Array<Record<string, unknown>>;
    writeControl?: { requiredRevisionId: string };
  };
  /** A human-readable summary of what was translated, for the response text. */
  summary: string;
}

/** Rejection — caller surfaces `reason` to the agent. */
export interface DocsSyncRejection {
  reason: string;
}

export type DocsSyncResult = DocsSyncRequest | DocsSyncRejection;

/** Translate a mutation intent into a batchUpdate request, or reject it. */
export function translateMutation(
  intent: DocsSyncIntent,
  revisionId: string | undefined,
): DocsSyncResult {
  // `json_delete` and `json_insert` only ever shape up as structural edits in
  // a Docs document (removing a paragraph, inserting into the content array).
  // The Docs API has no JSON-replace primitive; structural changes need
  // distinct operations per element type. Out of scope for #79 — reject so
  // the agent uses markdown mode (re-author + doc_create / doc_write).
  if (intent.op === 'delete' || intent.op === 'insert') {
    return {
      reason: `json_${intent.op} on a docs-bound scratchpad is structural — use markdown mode (export the doc, edit, doc_create or doc_write).`,
    };
  }

  const split = splitTabPrefix(parsePath(intent.path));
  if (!split) return { reason: unsupportedPath(intent.path) };

  if (isTextRunContentPath(split.tail)) {
    return translateTextContent(intent, split, revisionId);
  }

  if (isParagraphStylePath(split.tail)) {
    return translateParagraphStyle(intent, split, revisionId);
  }

  return { reason: unsupportedPath(intent.path) };
}

function unsupportedPath(path: string): string {
  return `path ${path} is not supported for live Docs sync. Supported: '$.tabs[T].documentTab.body.content[N].paragraph.elements[M].textRun.content' (text) and '$.tabs[T].documentTab.body.content[N].paragraph.paragraphStyle.<field>' (paragraph style). For structural edits use markdown mode.`;
}

// ── Path-shape matchers ──────────────────────────────────────

/**
 * A path split at `body`: the part that locates a TAB, and the part that locates
 * content within it.
 *
 * Splitting rather than matching one fixed shape is what lets nested tabs work —
 * `tabs[0].childTabs[2].documentTab.body.…` has the same tail as a top-level tab
 * and only differs in the prefix.
 */
interface PathSplit {
  /**
   * TRUE only for the tabless `$.body.…` shape, where there is no tab to name and a
   * request carrying no tabId is correct.
   *
   * Stated rather than inferred from `tabPath.length === 0`: `$.documentTab.body.…`
   * also yields an empty tabPath, and reading that as "tabless" would emit an untagged
   * write. It is unreachable today only because `navigate` fails a few lines later —
   * an accident, not the guard. This flag makes the guard the one we wrote.
   */
  tabless: boolean;
  /** Path to the tab OBJECT (`tabs[T]`, `tabs[T].childTabs[C]`, …). Empty when the buffer carries no tabs. */
  tabPath: (string | number)[];
  /** Path to the `body` the content hangs from, `body` included — just `['body']` for a tabless buffer. */
  bodyPrefix: (string | number)[];
  /** `body` onward — the shape the matchers below test. */
  tail: (string | number)[];
}

function splitTabPrefix(segments: (string | number)[]): PathSplit | null {
  const bodyIdx = segments.findIndex((seg, i) => seg === 'body' && segments[i + 1] === 'content');
  if (bodyIdx < 0) return null;

  // No prefix: the tabless response shape. Everything below still works; the
  // requests simply carry no tabId, which is what Google's pre-tabs behaviour was.
  if (bodyIdx === 0) {
    return { tabless: true, tabPath: [], bodyPrefix: ['body'], tail: segments };
  }

  // With a prefix, `body` must hang off a `documentTab` — anything else is a path
  // into some other part of the response that happens to contain the word "body".
  if (segments[bodyIdx - 1] !== 'documentTab') return null;

  return {
    tabless: false,
    tabPath: segments.slice(0, bodyIdx - 1),
    bodyPrefix: segments.slice(0, bodyIdx + 1),
    tail: segments.slice(bodyIdx),
  };
}

function isTextRunContentPath(tail: (string | number)[]): boolean {
  return tail.length === 8
    && tail[0] === 'body'
    && tail[1] === 'content'
    && typeof tail[2] === 'number'
    && tail[3] === 'paragraph'
    && tail[4] === 'elements'
    && typeof tail[5] === 'number'
    && tail[6] === 'textRun'
    && tail[7] === 'content';
}

function isParagraphStylePath(tail: (string | number)[]): boolean {
  return tail.length === 6
    && tail[0] === 'body'
    && tail[1] === 'content'
    && typeof tail[2] === 'number'
    && tail[3] === 'paragraph'
    && tail[4] === 'paragraphStyle'
    && typeof tail[5] === 'string';
}

// ── Translators ──────────────────────────────────────────────

function translateTextContent(
  intent: DocsSyncIntent,
  split: PathSplit,
  revisionId: string | undefined,
): DocsSyncResult {
  if (typeof intent.value !== 'string') {
    return { reason: `textRun.content value must be a string, got ${typeof intent.value}` };
  }
  // A newline in the new value adds a paragraph break — that's a structural
  // edit, not a text-content edit. Rejecting keeps the supported surface
  // narrow and predictable; structural authoring belongs in markdown mode.
  if (intent.value.includes('\n')) {
    return { reason: 'newline in new value is a structural edit (adds a paragraph break) — use markdown mode for multi-paragraph content.' };
  }

  const contentIdx = split.tail[2] as number;
  const elementIdx = split.tail[5] as number;

  let doc: unknown;
  try {
    doc = JSON.parse(intent.beforeJson);
  } catch {
    return { reason: 'buffer JSON parse failed — fix syntax errors before sync.' };
  }

  const tab = resolveTabId(doc, split);
  if ('reason' in tab) return tab;

  const element = navigate(doc, [...split.bodyPrefix, 'content', contentIdx, 'paragraph', 'elements', elementIdx]);
  if (!element || typeof element !== 'object') {
    return { reason: `element at ${intent.path} not found in buffer.` };
  }
  const e = element as Record<string, unknown>;
  const startIndex = e.startIndex;
  const endIndex = e.endIndex;
  const textRun = e.textRun as Record<string, unknown> | undefined;
  const oldContent = textRun?.content;

  if (typeof startIndex !== 'number' || typeof endIndex !== 'number') {
    return { reason: `element at content[${contentIdx}].elements[${elementIdx}] is missing startIndex/endIndex.` };
  }
  if (typeof oldContent !== 'string') {
    return { reason: `element at content[${contentIdx}].elements[${elementIdx}] is not a textRun (or has no content).` };
  }

  // Trailing-newline trap: if the run's content ends with `\n`, that newline
  // IS the paragraph break. Deleting through endIndex removes the paragraph;
  // delete through endIndex-1 instead and the paragraph survives.
  const deleteEnd = oldContent.endsWith('\n') ? endIndex - 1 : endIndex;
  // Defensive: if the element is a bare-newline run (oldContent === '\n'),
  // there's nothing to delete; just insert.
  const requests: Array<Record<string, unknown>> = [];
  if (deleteEnd > startIndex) {
    requests.push({
      deleteContentRange: { range: { startIndex, endIndex: deleteEnd, ...tab.on } },
    });
  }
  requests.push({
    insertText: { text: intent.value, location: { index: startIndex, ...tab.on } },
  });

  return {
    body: {
      requests,
      ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}),
    },
    summary: `text content @ ${tab.label}content[${contentIdx}].elements[${elementIdx}] (${oldContent.length} → ${intent.value.length} chars)`,
  };
}

function translateParagraphStyle(
  intent: DocsSyncIntent,
  split: PathSplit,
  revisionId: string | undefined,
): DocsSyncResult {
  const contentIdx = split.tail[2] as number;
  const field = split.tail[5] as string;

  let doc: unknown;
  try {
    doc = JSON.parse(intent.beforeJson);
  } catch {
    return { reason: 'buffer JSON parse failed — fix syntax errors before sync.' };
  }

  const tab = resolveTabId(doc, split);
  if ('reason' in tab) return tab;

  const structural = navigate(doc, [...split.bodyPrefix, 'content', contentIdx]);
  if (!structural || typeof structural !== 'object') {
    return { reason: `${tab.label}content[${contentIdx}] not found in buffer.` };
  }
  const s = structural as Record<string, unknown>;
  const startIndex = s.startIndex;
  const endIndex = s.endIndex;
  if (typeof startIndex !== 'number' || typeof endIndex !== 'number') {
    return { reason: `${tab.label}content[${contentIdx}] is missing startIndex/endIndex.` };
  }
  if (!s.paragraph) {
    return { reason: `${tab.label}content[${contentIdx}] is not a paragraph (paragraphStyle only applies to paragraphs).` };
  }

  return {
    body: {
      requests: [{
        updateParagraphStyle: {
          range: { startIndex, endIndex, ...tab.on },
          paragraphStyle: { [field]: intent.value },
          fields: field,
        },
      }],
      ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}),
    },
    summary: `paragraphStyle.${field} @ ${tab.label}content[${contentIdx}]`,
  };
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * The tab a path addresses, as the fragment to spread onto every request that
 * carries a Location or a Range.
 *
 * Google resolves an omitted `tabId` to the FIRST tab, so a missing id is not a
 * missing option — it is a write to the wrong tab that reports success. When the
 * path names a tab, its id must be present or the translation fails here.
 *
 * `label` prefixes the summary and every error message below, so a rejection says
 * which tab it was talking about rather than a bare `content[4]` that could be
 * any of forty.
 */
function resolveTabId(
  doc: unknown,
  split: PathSplit,
): { on: { tabId?: string }; label: string } | DocsSyncRejection {
  // A tabless buffer addresses the only body there is; no tabId to carry.
  if (split.tabless) return { on: {}, label: '' };

  const tab = navigate(doc, split.tabPath);
  if (!tab || typeof tab !== 'object') {
    return { reason: `tab at ${split.tabPath.join('.')} not found in buffer.` };
  }
  const props = (tab as Record<string, unknown>).tabProperties as Record<string, unknown> | undefined;
  const tabId = props?.tabId;
  if (typeof tabId !== 'string' || !tabId) {
    return {
      reason: `tab at ${split.tabPath.join('.')} has no tabProperties.tabId — without it the Docs API would apply this edit to the FIRST tab. Re-import the scratchpad to refresh the buffer.`,
    };
  }
  return { on: { tabId }, label: `tab ${tabId} ` };
}

function navigate(obj: unknown, segments: (string | number)[]): unknown {
  let current = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[String(seg)];
  }
  return current;
}

/** Type guard — narrows DocsSyncResult to the rejection arm. */
export function isRejection(result: DocsSyncResult): result is DocsSyncRejection {
  return 'reason' in result;
}
