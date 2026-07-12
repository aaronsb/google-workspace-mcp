/**
 * Docs patch — custom handlers for operations that use batchUpdate.
 *
 * insertText and replaceText use documents.batchUpdate which requires
 * a --json request body, not --params.
 */

import { call } from '../../google/client.js';
import { requireString } from '../../server/handlers/validate.js';
import type { ServicePatch } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

export const docsPatch: ServicePatch = {
  customHandlers: {
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
