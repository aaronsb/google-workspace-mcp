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
 * Two supported path shapes:
 *
 *  1. `$.body.content[N].paragraph.elements[M].textRun.content`
 *     Text content change → `deleteContentRange(startIndex, endIndex)` +
 *     `insertText(text=newValue, location.index=startIndex)`. Watch the
 *     trailing-newline trap: a textRun whose content ends with `\n` includes
 *     the paragraph break in its range; deleting through it removes the
 *     paragraph. We delete `endIndex - 1` in that case to preserve the break.
 *     A `\n` in the new value is rejected — that's a structural edit dressed
 *     as a text change.
 *
 *  2. `$.body.content[N].paragraph.paragraphStyle.<field>`
 *     Paragraph style change → `updateParagraphStyle` over the element's
 *     range with `fields: <field>`. We don't pre-validate the field name —
 *     the API rejects unknown fields cleanly and we surface its message.
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

  const segments = parsePath(intent.path);

  if (isTextRunContentPath(segments)) {
    return translateTextContent(intent, segments, revisionId);
  }

  if (isParagraphStylePath(segments)) {
    return translateParagraphStyle(intent, segments, revisionId);
  }

  return {
    reason: `path ${intent.path} is not supported for live Docs sync. Supported: '$.body.content[N].paragraph.elements[M].textRun.content' (text) and '$.body.content[N].paragraph.paragraphStyle.<field>' (paragraph style). For structural edits use markdown mode.`,
  };
}

// ── Path-shape matchers ──────────────────────────────────────

function isTextRunContentPath(segments: (string | number)[]): boolean {
  return segments.length === 8
    && segments[0] === 'body'
    && segments[1] === 'content'
    && typeof segments[2] === 'number'
    && segments[3] === 'paragraph'
    && segments[4] === 'elements'
    && typeof segments[5] === 'number'
    && segments[6] === 'textRun'
    && segments[7] === 'content';
}

function isParagraphStylePath(segments: (string | number)[]): boolean {
  return segments.length === 6
    && segments[0] === 'body'
    && segments[1] === 'content'
    && typeof segments[2] === 'number'
    && segments[3] === 'paragraph'
    && segments[4] === 'paragraphStyle'
    && typeof segments[5] === 'string';
}

// ── Translators ──────────────────────────────────────────────

function translateTextContent(
  intent: DocsSyncIntent,
  segments: (string | number)[],
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

  const contentIdx = segments[2] as number;
  const elementIdx = segments[5] as number;

  let doc: unknown;
  try {
    doc = JSON.parse(intent.beforeJson);
  } catch {
    return { reason: 'buffer JSON parse failed — fix syntax errors before sync.' };
  }

  const element = navigate(doc, ['body', 'content', contentIdx, 'paragraph', 'elements', elementIdx]);
  if (!element || typeof element !== 'object') {
    return { reason: `element at body.content[${contentIdx}].paragraph.elements[${elementIdx}] not found in buffer.` };
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
      deleteContentRange: { range: { startIndex, endIndex: deleteEnd } },
    });
  }
  requests.push({
    insertText: { text: intent.value, location: { index: startIndex } },
  });

  return {
    body: {
      requests,
      ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}),
    },
    summary: `text content @ content[${contentIdx}].elements[${elementIdx}] (${oldContent.length} → ${intent.value.length} chars)`,
  };
}

function translateParagraphStyle(
  intent: DocsSyncIntent,
  segments: (string | number)[],
  revisionId: string | undefined,
): DocsSyncResult {
  const contentIdx = segments[2] as number;
  const field = segments[5] as string;

  let doc: unknown;
  try {
    doc = JSON.parse(intent.beforeJson);
  } catch {
    return { reason: 'buffer JSON parse failed — fix syntax errors before sync.' };
  }

  const structural = navigate(doc, ['body', 'content', contentIdx]);
  if (!structural || typeof structural !== 'object') {
    return { reason: `content[${contentIdx}] not found in buffer.` };
  }
  const s = structural as Record<string, unknown>;
  const startIndex = s.startIndex;
  const endIndex = s.endIndex;
  if (typeof startIndex !== 'number' || typeof endIndex !== 'number') {
    return { reason: `content[${contentIdx}] is missing startIndex/endIndex.` };
  }
  if (!s.paragraph) {
    return { reason: `content[${contentIdx}] is not a paragraph (paragraphStyle only applies to paragraphs).` };
  }

  return {
    body: {
      requests: [{
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: { [field]: intent.value },
          fields: field,
        },
      }],
      ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}),
    },
    summary: `paragraphStyle.${field} @ content[${contentIdx}]`,
  };
}

// ── Helpers ──────────────────────────────────────────────────

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
