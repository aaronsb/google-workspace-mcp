/**
 * Gmail patch — domain-specific hooks for the email service.
 *
 * Key customizations:
 * - Search hydration: messages.list only returns IDs, so we fetch metadata
 * - Custom formatters: pipe-delimited list, header-extracted detail
 * - Custom handlers: send/reply use specific response formatting
 */

import { execute } from '../../executor/gws.js';
import { formatEmailList, formatEmailDetail } from '../../server/formatting/markdown.js';
import { nextSteps } from '../../server/formatting/next-steps.js';
import { requireString } from '../../server/handlers/validate.js';
import type { ServicePatch, PatchContext } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

/**
 * Hydrate message IDs with metadata (From, Subject, Date, snippet).
 * Reused from the original email handler.
 */
async function hydrateMessages(
  messageIds: Array<{ id: string }>,
  account: string,
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    messageIds.map(async (msg) => {
      try {
        const result = await execute([
          'gmail', 'users', 'messages', 'get',
          '--params', JSON.stringify({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          }),
        ], { account });
        const data = result.data as Record<string, unknown>;
        const headers = ((data.payload as Record<string, unknown>)?.headers ?? []) as Array<{ name: string; value: string }>;
        const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;
        return {
          id: data.id,
          threadId: data.threadId,
          from: getHeader('from'),
          subject: getHeader('subject'),
          date: getHeader('date'),
          snippet: data.snippet,
        };
      } catch {
        return { id: msg.id };
      }
    }),
  );
}

export const gmailPatch: ServicePatch = {
  afterExecute: {
    search: async (result, ctx) => {
      // messages.list returns bare IDs — hydrate with metadata
      const raw = result as Record<string, unknown>;
      const ids = (raw?.messages ?? []) as Array<{ id: string }>;
      if (ids.length === 0) return { messages: [] };
      const messages = await hydrateMessages(ids, ctx.account);
      return { messages };
    },
  },

  formatList: (data: unknown) => formatEmailList(data),
  formatDetail: (data: unknown) => formatEmailDetail(data),

  customHandlers: {
    send: async (params, account): Promise<HandlerResponse> => {
      const to = requireString(params, 'to');
      const subject = requireString(params, 'subject');
      const body = requireString(params, 'body');
      const result = await execute([
        'gmail', '+send',
        '--to', to, '--subject', subject, '--body', body,
      ], { account });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Email sent to ${to}.\n\n**Subject:** ${subject}\n**Message ID:** ${data.id ?? 'unknown'}` +
          nextSteps('email', 'send', { email: account }),
        refs: { id: data.id, threadId: data.threadId, to, subject },
      };
    },

    reply: async (params, account): Promise<HandlerResponse> => {
      const messageId = requireString(params, 'messageId');
      const body = requireString(params, 'body');
      const result = await execute([
        'gmail', '+reply', '--message-id', messageId, '--body', body,
      ], { account });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Reply sent.\n\n**Message ID:** ${data.id ?? 'unknown'}` +
          nextSteps('email', 'reply', { email: account }),
        refs: { id: data.id, threadId: data.threadId, messageId },
      };
    },
  },
};
