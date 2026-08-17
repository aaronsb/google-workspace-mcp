/**
 * Docs patch — custom handlers for operations Google's raw response does not serve.
 *
 * write / insertText / replaceText go through documents.batchUpdate, which needs a
 * request body rather than query parameters.
 *
 * `get` is here for a different reason: see extractText below.
 */

import { call } from '../../google/client.js';
import { optionalString, requireString } from '../../server/handlers/validate.js';
import { estimateTokens } from '../../server/formatting/markdown.js';
import type { ServicePatch } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

/**
 * Pull the readable text out of a Docs document.
 *
 * Google returns a document's text buried in
 * `body.content[].paragraph.elements[].textRun.content`, and returns nothing at the
 * top level except title/revisionId/documentId. `get` was a bare resource op, so its
 * response went through the generic formatter, which renders top-level scalars — and
 * dropped the entire document. The tool described itself as "get document content and
 * metadata" and returned only metadata, on every document, with no error.
 *
 * This is the shape of regression ADR-103 predicted: we no longer inherit a CLI's
 * pre-chewed response, so anywhere the raw Google shape is nested, the reshaping has
 * to be ours. `get` was missed.
 *
 * Tables and tables-of-contents nest further `content` arrays, so this recurses rather
 * than assuming a flat list of paragraphs — a doc with a table would otherwise lose
 * everything inside it.
 */
function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  if (Array.isArray(node)) return node.map(extractText).join('');

  const n = node as Record<string, unknown>;

  // A leaf: the actual characters.
  const textRun = n.textRun as { content?: unknown } | undefined;
  if (textRun && typeof textRun.content === 'string') return textRun.content;

  let out = '';
  for (const key of ['content', 'elements', 'tableRows', 'tableCells', 'paragraph', 'table', 'tableOfContents']) {
    if (key in n) out += extractText(n[key]);
  }
  return out;
}

/** Collapse runs of blank lines; a Doc is full of them and they carry no meaning here. */
function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

interface FlatTab {
  /**
   * `tabProperties.tabId` — the ONLY handle that addresses a tab, on either side. A read
   * scoped with `tabId` and a write targeted with it use the same value, which is what
   * makes the two coordinate systems one (#157, #158). NULL when Google omitted it: such
   * a tab can be read as part of the whole document but cannot be addressed.
   */
  id: string | null;
  title: string;
  /**
   * NULL means Google returned no `documentTab` for this tab, so we did not read it.
   * That is NOT the same claim as "this tab is empty", and collapsing the two is how a
   * document nobody could read renders as a document with nothing in it — the defect
   * this whole file is a correction for, one level in.
   */
  text: string | null;
  /** 0 for a top-level tab, +1 per level of `childTabs` nesting. */
  depth: number;
}

/** Lines in a tab's text — counted one way, so every number here means the same thing. */
function countLines(text: string | null): number {
  return text ? text.split('\n').length : 0;
}

/**
 * Flatten a document's tabs, depth-first, into the order a reader sees them.
 *
 * Tabs are a TREE, not a list: each carries its own body at `documentTab.body` and may
 * nest further tabs under `childTabs`. A walk that reads only the top level silently
 * drops every nested tab, which is the same failure this function exists to fix, one
 * level down.
 *
 * Google populates none of this unless documents.get is asked for it — see `get`.
 *
 * Array order is Google's order, which is reading order; `tabProperties.index` carries
 * the same thing and is not consulted.
 */
function flattenTabs(tabs: unknown, depth = 0): FlatTab[] {
  if (!Array.isArray(tabs)) return [];

  const out: FlatTab[] = [];
  for (const tab of tabs) {
    if (!tab || typeof tab !== 'object') continue;
    const t = tab as Record<string, unknown>;

    const props = t.tabProperties as { title?: unknown; tabId?: unknown } | undefined;
    const documentTab = t.documentTab as { body?: unknown } | undefined;

    out.push({
      id: typeof props?.tabId === 'string' && props.tabId ? props.tabId : null,
      title: typeof props?.title === 'string' && props.title ? props.title : '(untitled tab)',
      // No documentTab at all is a failed read, not an empty tab. Keep them distinct.
      text: documentTab ? tidy(extractText(documentTab.body)) : null,
      depth,
    });
    // Nested tabs belong directly after their parent, not in a separate pass.
    out.push(...flattenTabs(t.childTabs, depth + 1));
  }
  return out;
}

/**
 * Render one tab as a titled section, headed by the id that addresses it.
 *
 * The id goes in the TEXT, not just in `refs`. Only `result.text` is returned to the
 * model — `refs` is internal, read by bulk_operations for chaining — so a tab id that
 * lives only in refs cannot be used by the agent reading this. Telling a reader to "pass
 * the tabId" while keeping every tabId out of the response is #158's original complaint
 * with a new hiding place.
 *
 * The heading level tracks nesting depth so a subtab reads as subordinate to its parent.
 * Depth is clamped at `######` because markdown has no seventh level: tabs nested more
 * than three deep flatten to the same visual level. That is deliberate and currently
 * unreachable — the Docs UI allows a single level of subtabs — so the clamp is a
 * guard against a shape Google's API permits and its editor does not produce.
 */
function renderTab({ id, title, text, depth }: FlatTab): string {
  const heading = '#'.repeat(Math.min(3 + depth, 6));
  const handle = id ? ` — \`${id}\`` : ' — _(no tab id; not individually addressable)_';
  const body = text === null
    ? '_(no content returned for this tab — it was not read, which is not the same as empty)_'
    : text || '_(this tab is empty)_';
  return `${heading} ${title}${handle}\n\n${body}\n`;
}

/**
 * Size at which a whole-document read turns into an index of its tabs.
 *
 * Matches `MAX_BODY_TOKENS` in server/formatting/markdown.ts, and carries the same rule:
 * a cap that does not say it capped recreates #152 with a different cause.
 *
 * The number is set by the MCP CLIENT's tool-result ceiling, not by taste. Measured live
 * against a real 2-tab meeting archive: 79,944 characters — 19,986 tokens by the estimate
 * below — sailed under a 25,000 threshold, and the client rejected the response anyway,
 * handing the agent a file path instead of the tab index this cap exists to produce. A cap
 * above the client's ceiling never fires where it matters.
 *
 * That measurement also says `estimateTokens` runs OPTIMISTIC on dense prose: 4 chars per
 * token, where the real tokenizer wanted closer to 3.2. So the threshold sits well under
 * the ceiling rather than at it, and that document now becomes an index as intended.
 */
const MAX_DOC_TOKENS = 12_000;

/**
 * Render the tab index a caller gets instead of an over-sized document.
 *
 * This is a cap with an escape hatch rather than a truncation: every tab is listed with
 * the id that fetches it, so no text becomes unreachable — it becomes reachable one tab
 * at a time. Truncating the concatenation instead would drop the tail of the document
 * with no way to ask for it, which is what #152 was.
 *
 * A tab Google gave no id can only be read as part of the whole document, so say that in
 * its row rather than printing an id that does not exist.
 */
function renderTabIndex(tabs: FlatTab[], tokens: number): string {
  const rows = tabs.map((t) => {
    const indent = '  '.repeat(t.depth);
    const size = t.text === null
      ? 'not read'
      : `${t.text.length} chars, ${countLines(t.text)} line(s)`;
    const handle = t.id ? `\`${t.id}\`` : '_(no tab id — not individually addressable)_';
    return `${indent}- ${handle} — ${t.title} (${size})`;
  });

  return `> **This document is ~${tokens.toLocaleString()} tokens across ${tabs.length} tab(s).** ` +
    `Showing the tab index instead of the text. Re-read with \`tabId\` set to one of the ids below.\n\n` +
    rows.join('\n') + '\n';
}

export const docsPatch: ServicePatch = {
  customHandlers: {
    /**
     * Read a document: its metadata AND — the point of the operation — ALL of its text.
     *
     * `includeTabsContent` is not an enhancement, it is the difference between reading
     * the document and reading part of it. Google's `body` field is legacy: without the
     * flag it holds THE FIRST TAB ONLY, and the response carries no hint that other tabs
     * exist. A doc holding one meeting transcript per tab returned 142 of its 780 lines
     * and presented them as the whole file (issue #152).
     *
     * That is this codebase's recurring defect shape — a read that under-reports with no
     * error, indistinguishable from a document that really is short. The same instinct
     * as the rate-limit retry in google/client.ts: never let "I could not see all of it"
     * render as "this is all there is".
     *
     * With the flag, content moves to `tabs[].documentTab.body` and `body` is GONE — not
     * empty, absent from the response, along with `headers`, `lists`, `inlineObjects` and
     * `namedStyles`. Measured live against three real documents: without the flag,
     * `body` held 10,388 characters and `tabs` was absent; with it, `body` was absent and
     * the three tabs held 10,388 + 3,832 + 698. So reading `tabs` first is load-bearing,
     * not a preference — read `body` first and a tabbed document comes back EMPTY. The
     * `body` fallback covers only the flagless shape, which nothing here now requests.
     *
     * Google's reference says `body` is "left as empty" rather than dropped; measurement
     * says dropped. The code assumes neither: it treats an empty `tabs[0]` and an absent
     * `body` the same way round, so both shapes read correctly.
     *
     * Single-tab documents report one tab titled "Tab 1" — a default, not something a
     * user typed, so one tab renders with no tab scaffolding at all.
     *
     * `tabId` narrows the read to one tab (#158). It is the same handle the write
     * operations take, so "read this tab, then write to it" is one coordinate system
     * rather than two that happen to agree on single-tab documents.
     */
    get: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const wantTabId = optionalString(params, 'tabId');

      const doc = await call('docs', 'documents.get',
        { documentId, includeTabsContent: true }, { account }) as Record<string, unknown>;

      const title = typeof doc.title === 'string' ? doc.title : '(untitled)';
      const allTabs = flattenTabs(doc.tabs);

      // A tabId that matches nothing must fail loudly. Falling back to the whole document
      // would hand back text the caller did not ask for and let them believe it was the
      // one tab they named — a wrong-scope read that reports success, which is the shape
      // of defect this file exists to stop.
      if (wantTabId && !allTabs.some((t) => t.id === wantTabId)) {
        const known = allTabs.map((t) => t.id).filter(Boolean);
        throw new Error(
          `No tab with id "${wantTabId}" in document ${documentId}. ` +
          (known.length
            ? `Available tab ids: ${known.join(', ')}.`
            : 'This document reported no addressable tab ids; read it without `tabId`.'),
        );
      }

      const tabs = wantTabId ? allTabs.filter((t) => t.id === wantTabId) : allTabs;
      // Scaffolding marks a read that spans tabs. A single-tab read is scoped by
      // construction, so it renders bare even when the document has forty tabs.
      const multiTab = tabs.length > 1;

      // One tab is the ordinary case and reads best with no tab scaffolding at all, so it
      // renders exactly as a single-body document does. `||` not `??`: a single tab that
      // reported NO content must still fall back to `body`, and '' is not nullish — with
      // `??` a populated `body` was discarded and the document reported as empty.
      //
      // A tabId-scoped read takes NO body fallback. `body` is the legacy first tab, so
      // serving it for an empty tab three tabs along would answer a question about one tab
      // with the text of another — and the caller, having named a tab, has no reason to
      // suspect it.
      const singleText = tabs.length === 1 && !wantTabId
        ? (tabs[0].text || tidy(extractText(doc.body)))
        : tabs.length === 1
          ? (tabs[0].text ?? '')
          : tidy(extractText(doc.body));

      // A scoped read of a tab Google did not return must say THAT, not "empty". Falling
      // through to the empty-document string below would print "the document is empty"
      // for a tab we simply could not read — the substitution this file exists to stop,
      // reached by the one path that bypasses renderTab.
      const unreadScope = tabs.length === 1 && tabs[0].text === null;

      const fullBody = multiTab
        ? tabs.map(renderTab).join('\n').trimEnd()
        : unreadScope
          ? '_(no content returned for this tab — it was not read, which is not the same as empty)_'
          : singleText;

      // Over the cap, a multi-tab read becomes an index of tabs to read individually.
      // A single tab has nothing narrower to offer, so it comes back whole however large
      // it is: capping there would remove text with no way to ask for it again.
      //
      // A tab Google gave no id is reachable ONLY through the whole-document read, so
      // capping a document that contains one would put its text beyond every call —
      // truncation wearing an index's clothes. Leave those documents whole.
      const tokens = estimateTokens(fullBody);
      const capped = multiTab
        && tokens > MAX_DOC_TOKENS
        && tabs.every((t) => t.id !== null);
      const body = capped ? renderTabIndex(tabs, tokens) : fullBody;

      // Both numbers describe DOCUMENT TEXT, never the scaffolding rendered around it.
      // They used to disagree: characters summed the tabs while lines counted the
      // rendered output, headings and placeholders included, so a document of four
      // one-line tabs reported "71 characters, 15 line(s)" and a wholly unread one
      // managed "0 characters, 11 line(s)".
      const characters = multiTab
        ? tabs.reduce((sum, t) => sum + (t.text?.length ?? 0), 0)
        : singleText.length;
      const lines = multiTab
        ? tabs.reduce((sum, t) => sum + countLines(t.text), 0)
        : countLines(singleText);

      const nested = tabs.filter((t) => t.depth > 0).length;
      const unread = tabs.filter((t) => t.text === null).length;

      // Anything that makes this response narrower than the document says so HERE, in the
      // response, rather than leaving the reader to infer it from a number.
      const caveats: string[] = [];
      if (tabs.length === 0) {
        // Asked for tab content and got none. Measured live, every document returns at
        // least one tab when the flag is set, so this is an anomaly and `body` may well be
        // the first tab of several.
        caveats.push('Google returned no tab data, so this may be the first tab only.');
      }
      if (unread > 0) {
        caveats.push(`${unread} tab(s) returned no content and could not be read.`);
      }
      if (multiTab && !capped) {
        // The read spans tabs and character indices do not. An index computed from this
        // concatenation means nothing to `insertText` unless the same tab is named on
        // both sides, so say which handle makes them agree (#157).
        //
        // A capped response carries no text to measure an index in, and its own notice
        // already says what to do next — two instructions there would compete.
        caveats.push('Indices in this response are per-tab. Pass the `tabId` beside each heading below to `get`, `insertText`, `write` or `replaceText` — without one they act on the FIRST tab.');
      }
      if (!capped && !multiTab && tokens > MAX_DOC_TOKENS) {
        // Whole, and large. Nothing here was withheld — the number is so the caller can
        // decide what to do with the rest of its context, not a warning of missing text.
        caveats.push(`This tab is ~${tokens.toLocaleString()} tokens and is shown in full — there is no narrower read available.`);
      }
      if (!capped && multiTab && tokens > MAX_DOC_TOKENS) {
        // Big enough to cap, held back because at least one tab has no id and a tab index
        // would strand it. Say why, or the reader sees only an inconsistent threshold.
        caveats.push(`This document is ~${tokens.toLocaleString()} tokens and is shown in full: some tabs have no id, so a tab index would leave their text unreachable.`);
      }

      const scoped = wantTabId ? tabs[0] : undefined;

      // A child tab is its own addressable tab, so scoping to a parent deliberately omits
      // it. The `1 of N` line exists to say what was left out; without this the reader has
      // no way to learn that the tab they asked for has text hanging beneath it.
      if (scoped) {
        const children = allTabs.filter((t) => t.depth === scoped.depth + 1
          && allTabs.indexOf(t) > allTabs.indexOf(scoped)
          && allTabs.slice(allTabs.indexOf(scoped) + 1, allTabs.indexOf(t)).every((b) => b.depth > scoped.depth));
        if (children.length > 0) {
          caveats.push(`This tab has ${children.length} child tab(s), read separately: ${children.map((c) => (c.id ? `\`${c.id}\`` : c.title)).join(', ')}.`);
        }
      }

      return {
        text:
          `## ${title}\n\n` +
          `**Document ID:** ${documentId}\n` +
          `**Revision:** ${String(doc.revisionId ?? '—')}\n` +
          // A scoped read says which tab it read AND how many it did not, so the number
          // beside "Length" is never mistaken for the whole document.
          (scoped
            ? `**Tab:** ${scoped.title} (\`${scoped.id}\`) — 1 of ${allTabs.length}\n`
            : '') +
          // The count includes nested tabs, which the Docs tab strip does not show — so
          // say which is which rather than hand back a number that contradicts the UI.
          (multiTab
            ? `**Tabs:** ${tabs.length}${nested ? ` (${tabs.length - nested} top-level, ${nested} nested)` : ''}\n`
            : '') +
          `**Length:** ${characters} characters, ${lines} line(s)\n` +
          caveats.map((c) => `\n> ${c}\n`).join('') +
          '\n' +
          (body ? `---\n\n${body}\n` : '_(the document is empty)_\n'),
        refs: {
          documentId,
          title,
          characters,
          lines,
          tabs: tabs.length,
          // The index rides along even for a single tab, whose heading is suppressed: its
          // title is usually Google's default "Tab 1", but when a user has renamed a
          // one-tab document's tab that name is content, and its id is the only way to
          // address a write. Both belong in the response whether or not it renders them.
          tabIndex: tabs.map((t) => ({
            tabId: t.id,
            title: t.title,
            depth: t.depth,
            characters: t.text?.length ?? null,
          })),
          ...(scoped ? { tabId: scoped.id, tabsInDocument: allTabs.length } : {}),
          ...(capped ? { capped: true, tokens } : {}),
          ...(unread > 0 ? { unreadTabs: unread } : {}),
        },
      };
    },

    /**
     * Append text to the end of the body: one documents.batchUpdate carrying a
     * single insertText at `endOfSegmentLocation`. Append-only — no index
     * targeting, no formatting.
     *
     * `tabId` picks the tab; omitted, Google appends to the FIRST tab. That default is
     * its documented behaviour for every Location and EndOfSegmentLocation, and it is
     * why an unqualified append to a tabbed document lands somewhere the caller did not
     * choose (#157). Read the document first — `get` returns each tab's id.
     */
    write: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const text = requireString(params, 'text');
      const tabId = optionalString(params, 'tabId');

      await call('docs', 'documents.batchUpdate', {
        documentId,
        requests: [{
          insertText: {
            text,
            // An empty segmentId means the document BODY (as opposed to a header
            // or footer), and endOfSegmentLocation means "append".
            endOfSegmentLocation: { segmentId: '', ...(tabId ? { tabId } : {}) },
          },
        }],
      }, { account });

      return {
        text: `Appended ${text.length} character(s) to ${tabId ? `tab \`${tabId}\` of ` : ''}the document.\n\n**Document ID:** ${documentId}` +
          (tabId ? '' : '\n\n> No `tabId` given — this appended to the FIRST tab. On a multi-tab document, pass the `tabId` from `get`.'),
        refs: { documentId, appended: text.length, ...(tabId ? { tabId } : {}) },
      };
    },

    insertText: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const text = requireString(params, 'text');
      const tabId = optionalString(params, 'tabId');
      const index = Number(params.index);
      if (!Number.isInteger(index) || index < 1) {
        throw new Error('index must be a positive integer (1 = start of document body)');
      }

      await call('docs', 'documents.batchUpdate', {
        documentId,
        requests: [{
          insertText: {
            text,
            // Character indices are per-tab. Without a tabId this index is read against
            // the first tab, whatever tab the caller measured it in.
            location: { index, ...(tabId ? { tabId } : {}) },
          },
        }],
      }, { account });

      return {
        text: `Text inserted at index ${index}${tabId ? ` of tab \`${tabId}\`` : ''}.\n\n**Document:** ${documentId}\n**Inserted:** ${text.length} characters` +
          (tabId ? '' : '\n\n> No `tabId` given — index ' + index + ' was resolved against the FIRST tab. On a multi-tab document, pass the `tabId` the index came from.'),
        refs: { documentId, index, length: text.length, ...(tabId ? { tabId } : {}) },
      };
    },

    /**
     * Find and replace across the document, or within one tab.
     *
     * This is the one write that was never confined to the first tab: Google applies
     * ReplaceAllTextRequest to every tab when `tabsCriteria` is omitted. `tabId` narrows
     * it, so the default stays "the whole document" and nothing changes for callers who
     * do not pass one.
     */
    replaceText: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const findText = requireString(params, 'findText');
      const replaceWith = requireString(params, 'replaceWith');
      const tabId = optionalString(params, 'tabId');
      const matchCase = params.matchCase !== false;

      const data = await call('docs', 'documents.batchUpdate', {
        documentId,
        requests: [{
          replaceAllText: {
            containsText: {
              text: findText,
              matchCase,
            },
            replaceText: replaceWith,
            ...(tabId ? { tabsCriteria: { tabIds: [tabId] } } : {}),
          },
        }],
      }, { account }) as Record<string, unknown>;

      // Extract occurrence count from the reply
      const replies = (data.replies as Array<Record<string, unknown>>) || [];
      const replaceReply = replies[0]?.replaceAllText as Record<string, unknown> | undefined;
      const occurrences = replaceReply?.occurrencesChanged || 0;

      // "Text replaced … Occurrences: 0" reads as success for a replacement that changed
      // nothing. A `tabId` gives that outcome a second cause — right string, wrong tab —
      // and the two are indistinguishable unless the response leads with the miss.
      const scope = tabId ? `tab \`${tabId}\`` : 'all tabs';
      const headline = occurrences === 0
        ? `Nothing matched "${findText}" in ${scope} — the document is unchanged.` +
          (tabId ? '\n\n> Scoped to one tab. If the text lives in another, re-run with that `tabId` or omit it to span the document.' : '')
        : 'Text replaced.';

      return {
        text: `${headline}\n\n**Document:** ${documentId}\n**Scope:** ${scope}\n**Found:** "${findText}"\n**Replaced with:** "${replaceWith}"\n**Occurrences:** ${occurrences}`,
        refs: { documentId, occurrences, ...(tabId ? { tabId } : {}) },
      };
    },
  },
};
