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
  text: string;
  /** 0 for a top-level tab, +1 per level of `childTabs` nesting. */
  depth: number;
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
      text: tidy(extractText(documentTab?.body)),
      depth,
    });
    // Nested tabs belong directly after their parent, not in a separate pass.
    out.push(...flattenTabs(t.childTabs, depth + 1));
  }
  return out;
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
     * Single-tab documents report one tab titled "Tab 1" — a default, not something a
     * user typed, so one tab renders with no tab scaffolding at all.
     */
    get: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');

      const doc = await call('docs', 'documents.get',
        { documentId, includeTabsContent: true }, { account }) as Record<string, unknown>;

      const title = typeof doc.title === 'string' ? doc.title : '(untitled)';
      const tabs = flattenTabs(doc.tabs);

      // One tab is the ordinary case and reads best with no tab scaffolding at all, so
      // it renders exactly as a single-body document does.
      const body = tabs.length > 1
        ? tabs
          .map(({ title: tabTitle, text: tabText, depth }) =>
            `${'#'.repeat(Math.min(3 + depth, 6))} ${tabTitle}\n\n` +
            (tabText || '_(this tab is empty)_') + '\n')
          .join('\n')
          .trimEnd()
        : (tabs[0]?.text ?? tidy(extractText(doc.body)));

      const characters = tabs.length > 1
        ? tabs.reduce((sum, t) => sum + t.text.length, 0)
        : body.length;
      const lines = body ? body.split('\n').length : 0;

      return {
        text:
          `## ${title}\n\n` +
          `**Document ID:** ${documentId}\n` +
          `**Revision:** ${String(doc.revisionId ?? '—')}\n` +
          (tabs.length > 1 ? `**Tabs:** ${tabs.length}\n` : '') +
          `**Length:** ${characters} characters, ${lines} line(s)\n\n` +
          (body ? `---\n\n${body}\n` : '_(the document is empty)_\n'),
        refs: { documentId, title, characters, lines, tabs: tabs.length },
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
