/**
 * Docs patch — custom handlers for operations Google's raw response does not serve.
 *
 * write / insertText / replaceText go through documents.batchUpdate, which needs a
 * request body rather than query parameters.
 *
 * `get` is here for a different reason: see extractText below.
 */

import { call } from '../../google/client.js';
import { requireString } from '../../server/handlers/validate.js';
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

    const props = t.tabProperties as { title?: unknown } | undefined;
    const documentTab = t.documentTab as { body?: unknown } | undefined;

    out.push({
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
 * Render one tab as a titled section.
 *
 * The heading level tracks nesting depth so a subtab reads as subordinate to its parent.
 * Depth is clamped at `######` because markdown has no seventh level: tabs nested more
 * than three deep flatten to the same visual level. That is deliberate and currently
 * unreachable — the Docs UI allows a single level of subtabs — so the clamp is a
 * guard against a shape Google's API permits and its editor does not produce.
 */
function renderTab({ title, text, depth }: FlatTab): string {
  const heading = '#'.repeat(Math.min(3 + depth, 6));
  const body = text === null
    ? '_(no content returned for this tab — it was not read, which is not the same as empty)_'
    : text || '_(this tab is empty)_';
  return `${heading} ${title}\n\n${body}\n`;
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
     */
    get: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');

      const doc = await call('docs', 'documents.get',
        { documentId, includeTabsContent: true }, { account }) as Record<string, unknown>;

      const title = typeof doc.title === 'string' ? doc.title : '(untitled)';
      const tabs = flattenTabs(doc.tabs);
      const multiTab = tabs.length > 1;

      // One tab is the ordinary case and reads best with no tab scaffolding at all, so it
      // renders exactly as a single-body document does. `||` not `??`: a single tab that
      // reported NO content must still fall back to `body`, and '' is not nullish — with
      // `??` a populated `body` was discarded and the document reported as empty.
      const singleText = tabs.length === 1
        ? (tabs[0].text || tidy(extractText(doc.body)))
        : tidy(extractText(doc.body));

      const body = multiTab
        ? tabs.map(renderTab).join('\n').trimEnd()
        : singleText;

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
      if (multiTab) {
        // The read spans tabs; the writes do not. See #157.
        caveats.push('`insertText` indices are relative to the FIRST tab, and `write` appends to it — tab-targeted writes are not available yet (#157).');
      }

      return {
        text:
          `## ${title}\n\n` +
          `**Document ID:** ${documentId}\n` +
          `**Revision:** ${String(doc.revisionId ?? '—')}\n` +
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
          // Titles ride along even for a single tab, whose heading is suppressed: the
          // title is usually Google's default "Tab 1", but when a user has renamed a
          // one-tab document's tab, that name is content and withholding it is a choice.
          tabTitles: tabs.map((t) => t.title),
          ...(unread > 0 ? { unreadTabs: unread } : {}),
        },
      };
    },

    /**
     * Append text to the end of the body: one documents.batchUpdate carrying a
     * single insertText at `endOfSegmentLocation`. Append-only — no index
     * targeting, no formatting.
     */
    write: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const text = requireString(params, 'text');

      await call('docs', 'documents.batchUpdate', {
        documentId,
        requests: [{
          insertText: {
            text,
            // An empty segmentId means the document BODY (as opposed to a header
            // or footer), and endOfSegmentLocation means "append".
            endOfSegmentLocation: { segmentId: '' },
          },
        }],
      }, { account });

      return {
        text: `Appended ${text.length} character(s) to the document.\n\n**Document ID:** ${documentId}`,
        refs: { documentId, appended: text.length },
      };
    },

    insertText: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const text = requireString(params, 'text');
      const index = Number(params.index);
      if (!Number.isInteger(index) || index < 1) {
        throw new Error('index must be a positive integer (1 = start of document body)');
      }

      await call('docs', 'documents.batchUpdate', {
        documentId,
        requests: [{
          insertText: {
            text,
            location: { index },
          },
        }],
      }, { account });

      return {
        text: `Text inserted at index ${index}.\n\n**Document:** ${documentId}\n**Inserted:** ${text.length} characters`,
        refs: { documentId, index, length: text.length },
      };
    },

    replaceText: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const findText = requireString(params, 'findText');
      const replaceWith = requireString(params, 'replaceWith');
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
          },
        }],
      }, { account }) as Record<string, unknown>;

      // Extract occurrence count from the reply
      const replies = (data.replies as Array<Record<string, unknown>>) || [];
      const replaceReply = replies[0]?.replaceAllText as Record<string, unknown> | undefined;
      const occurrences = replaceReply?.occurrencesChanged || 0;

      return {
        text: `Text replaced.\n\n**Document:** ${documentId}\n**Found:** "${findText}"\n**Replaced with:** "${replaceWith}"\n**Occurrences:** ${occurrences}`,
        refs: { documentId, occurrences },
      };
    },
  },
};
