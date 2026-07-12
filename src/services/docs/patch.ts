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

export const docsPatch: ServicePatch = {
  customHandlers: {
    /**
     * Read a document: its metadata AND — the point of the operation — its text.
     */
    get: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');

      const doc = await call('docs', 'documents.get',
        { documentId }, { account }) as Record<string, unknown>;

      const title = typeof doc.title === 'string' ? doc.title : '(untitled)';
      const text = extractText(doc.body).replace(/\n{3,}/g, '\n\n').trim();
      const lines = text ? text.split('\n').length : 0;

      return {
        text:
          `## ${title}\n\n` +
          `**Document ID:** ${documentId}\n` +
          `**Revision:** ${String(doc.revisionId ?? '—')}\n` +
          `**Length:** ${text.length} characters, ${lines} line(s)\n\n` +
          (text ? `---\n\n${text}\n` : '_(the document is empty)_\n'),
        refs: { documentId, title, characters: text.length, lines },
      };
    },

    /**
     * Append text to the end of the body. Was gws's `+write`, which was exactly
     * one documents.batchUpdate carrying a single insertText at
     * `endOfSegmentLocation` — append-only, no index targeting, no formatting.
     * The helper added nothing Google did not already do.
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
