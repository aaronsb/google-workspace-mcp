/**
 * Docs patch — custom handlers for operations that use batchUpdate.
 *
 * insertText and replaceText use documents.batchUpdate which requires
 * a --json request body, not --params.
 */

import { execute } from '../../executor/gws.js';
import { nextSteps } from '../../server/formatting/next-steps.js';
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

      const body = {
        requests: [{
          insertText: {
            text,
            location: { index },
          },
        }],
      };

      await execute([
        'docs', 'documents', 'batchUpdate',
        '--params', JSON.stringify({ documentId }),
        '--json', JSON.stringify(body),
      ], { account });

      return {
        text: `Text inserted at index ${index}.\n\n**Document:** ${documentId}\n**Inserted:** ${text.length} characters` +
          nextSteps('docs', 'insertText', { email: account }),
        refs: { documentId, index, length: text.length },
      };
    },

    replaceText: async (params, account): Promise<HandlerResponse> => {
      const documentId = requireString(params, 'documentId');
      const findText = requireString(params, 'findText');
      const replaceWith = requireString(params, 'replaceWith');
      const matchCase = params.matchCase !== false;

      const body = {
        requests: [{
          replaceAllText: {
            containsText: {
              text: findText,
              matchCase,
            },
            replaceText: replaceWith,
          },
        }],
      };

      const result = await execute([
        'docs', 'documents', 'batchUpdate',
        '--params', JSON.stringify({ documentId }),
        '--json', JSON.stringify(body),
      ], { account });

      // Extract occurrence count from the reply
      const data = result.data as Record<string, unknown>;
      const replies = (data.replies as Array<Record<string, unknown>>) || [];
      const replaceReply = replies[0]?.replaceAllText as Record<string, unknown> | undefined;
      const occurrences = replaceReply?.occurrencesChanged || 0;

      return {
        text: `Text replaced.\n\n**Document:** ${documentId}\n**Found:** "${findText}"\n**Replaced with:** "${replaceWith}"\n**Occurrences:** ${occurrences}` +
          nextSteps('docs', 'replaceText', { email: account }),
        refs: { documentId, occurrences },
      };
    },
  },
};
