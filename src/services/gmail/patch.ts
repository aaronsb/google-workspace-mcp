/**
 * Gmail patch — domain-specific hooks for the email service.
 *
 * Key customizations:
 * - Search hydration: messages.list only returns IDs, so we fetch metadata
 * - Custom formatters: pipe-delimited list, header-extracted detail
 * - Custom handlers: send/reply use specific response formatting
 */

import * as fs from 'node:fs/promises';
import { execute } from '../../executor/gws.js';
import { resolveWorkspacePath, verifyPathSafety } from '../../executor/workspace.js';
import { formatEmailList, formatEmailDetail, extractBodyFromPayload } from '../../server/formatting/markdown.js';
import { nextSteps } from '../../server/formatting/next-steps.js';
import { requireString } from '../../server/handlers/validate.js';
import { handleGetAttachment, handleViewAttachment } from './attachments.js';
import { buildMimeMessage, lookupMimeType, type MimeAttachment } from './mime.js';
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

/** Format labels list — name, type, unread count. */
function formatLabelList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const labels = (raw?.labels ?? []) as Array<Record<string, unknown>>;

  if (labels.length === 0) {
    return { text: 'No labels found.', refs: { count: 0 } };
  }

  // Separate system and user labels
  const system = labels.filter(l => l.type === 'system');
  const user = labels.filter(l => l.type === 'user');

  const formatLabel = (l: Record<string, unknown>) => {
    const id = String(l.id ?? '');
    const name = String(l.name ?? '');
    const unread = l.messagesUnread ? ` (${l.messagesUnread} unread)` : '';
    return `${id} | ${name}${unread}`;
  };

  const parts: string[] = [];
  if (user.length > 0) {
    parts.push(`## User Labels (${user.length})\n`);
    parts.push(...user.map(formatLabel));
  }
  if (system.length > 0) {
    parts.push('', `## System Labels (${system.length})\n`);
    parts.push(...system.map(formatLabel));
  }

  return {
    text: parts.join('\n'),
    refs: {
      count: labels.length,
      labels: labels.map(l => ({ id: l.id, name: l.name })),
    },
  };
}

/** Format threads list — thread ID, snippet, message count. */
function formatThreadList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const threads = (raw?.threads ?? []) as Array<Record<string, unknown>>;

  if (threads.length === 0) {
    return { text: 'No threads found.', refs: { count: 0 } };
  }

  const lines = threads.map(t => {
    const id = String(t.id ?? '');
    const snippet = String(t.snippet ?? '').slice(0, 80);
    return `${id} | ${snippet}`;
  });

  return {
    text: `## Threads (${threads.length})\n\n${lines.join('\n')}`,
    refs: {
      count: threads.length,
      threadId: String(threads[0]?.id ?? ''),
      threads: threads.map(t => String(t.id ?? '')),
    },
  };
}

/** Format thread detail — all messages in the thread. */
function formatThreadDetail(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const messages = (raw?.messages ?? []) as Array<Record<string, unknown>>;
  const threadId = String(raw?.id ?? '');

  if (messages.length === 0) {
    return { text: 'Empty thread.', refs: { threadId } };
  }

  const parts: string[] = [`## Thread (${messages.length} messages)\n`];

  for (const msg of messages) {
    const payload = msg.payload as Record<string, unknown> | undefined;
    const headers = (payload?.headers ?? []) as Array<{ name: string; value: string }>;
    const getHeader = (name: string) =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

    const from = getHeader('from');
    const date = getHeader('date');
    const subject = getHeader('subject');
    const bodyText = extractBodyFromPayload(payload);
    const snippet = String(msg.snippet ?? '');
    // getThread uses format:metadata so body data is usually absent;
    // fall back to snippet when extraction yields nothing
    const displayBody = bodyText || snippet;

    parts.push(`**${from}** — ${date}`);
    if (subject) parts.push(`Subject: ${subject}`);
    parts.push(displayBody, '');
  }

  return {
    text: parts.join('\n'),
    refs: {
      threadId,
      messageCount: messages.length,
      messageId: String(messages[messages.length - 1]?.id ?? ''),
      messages: messages.map(m => String(m.id ?? '')),
    },
  };
}

/** Load files from workspace, resolve paths safely, return as MIME attachments. */
async function loadWorkspaceAttachments(filenames: string[]): Promise<MimeAttachment[]> {
  return Promise.all(filenames.map(async (name) => {
    const filePath = resolveWorkspacePath(name);
    await verifyPathSafety(filePath);
    const content = await fs.readFile(filePath);
    const mimeType = lookupMimeType(name);
    return { filename: name, mimeType, content };
  }));
}

export const gmailPatch: ServicePatch = {
  afterExecute: {
    search: async (result, ctx) => {
      // messages.list returns bare IDs — hydrate with metadata
      const raw = result as Record<string, unknown>;
      const ids = (raw?.messages ?? []) as Array<{ id: string }>;
      if (ids.length === 0) {
        // Preserve resultSizeEstimate so formatters can distinguish
        // "search ran, no matches" from unexpected empty responses
        return {
          messages: [],
          resultSizeEstimate: raw?.resultSizeEstimate ?? 0,
          query: ctx.params.query ?? '',
        };
      }
      const messages = await hydrateMessages(ids, ctx.account);
      return { messages, resultSizeEstimate: raw?.resultSizeEstimate };
    },
  },

  formatList: (data: unknown, ctx: PatchContext) => {
    switch (ctx.operation) {
      case 'labels':
        return formatLabelList(data);
      case 'threads':
        return formatThreadList(data);
      default:
        return formatEmailList(data);
    }
  },
  formatDetail: (data: unknown, ctx: PatchContext) => {
    switch (ctx.operation) {
      case 'getThread':
        return formatThreadDetail(data);
      default:
        return formatEmailDetail(data);
    }
  },

  customHandlers: {
    send: async (params, account): Promise<HandlerResponse> => {
      const to = requireString(params, 'to');
      const subject = requireString(params, 'subject');
      const body = requireString(params, 'body');
      const attachmentNames = params.attachments
        ? String(params.attachments).split(',').map(s => s.trim()).filter(Boolean)
        : [];

      let result;

      if (attachmentNames.length === 0) {
        // No attachments — use the +send helper (simpler, proven)
        const args = ['gmail', '+send', '--to', to, '--subject', subject, '--body', body];
        if (params.cc) args.push('--cc', String(params.cc));
        if (params.bcc) args.push('--bcc', String(params.bcc));
        if (params.html === true || params.html === 'true') args.push('--html');
        result = await execute(args, { account });
      } else {
        // With attachments — build MIME message and use raw API
        const attachments = await loadWorkspaceAttachments(attachmentNames);
        const raw = buildMimeMessage({
          to, subject, body,
          html: params.html === true || params.html === 'true',
          cc: params.cc ? String(params.cc) : undefined,
          bcc: params.bcc ? String(params.bcc) : undefined,
          from: account,
          attachments,
        });

        result = await execute([
          'gmail', 'users', 'messages', 'send',
          '--params', JSON.stringify({ userId: 'me' }),
          '--json', JSON.stringify({ raw }),
        ], { account });
      }

      const data = result.data as Record<string, unknown>;
      const attachNote = attachmentNames.length > 0
        ? `\n**Attachments:** ${attachmentNames.join(', ')}`
        : '';
      return {
        text: `Email sent to ${to}.\n\n**Subject:** ${subject}${attachNote}\n**Message ID:** ${data.id ?? 'unknown'}` +
          nextSteps('email', 'send', { email: account }),
        refs: { id: data.id, threadId: data.threadId, to, subject, attachments: attachmentNames },
      };
    },

    modify: async (params, account): Promise<HandlerResponse> => {
      const messageId = requireString(params, 'messageId');
      const addLabelIds = params.addLabelIds
        ? String(params.addLabelIds).split(',').map(s => s.trim())
        : [];
      const removeLabelIds = params.removeLabelIds
        ? String(params.removeLabelIds).split(',').map(s => s.trim())
        : [];

      if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
        throw new Error('At least one of addLabelIds or removeLabelIds is required');
      }

      const body: Record<string, string[]> = {};
      if (addLabelIds.length > 0) body.addLabelIds = addLabelIds;
      if (removeLabelIds.length > 0) body.removeLabelIds = removeLabelIds;

      const result = await execute([
        'gmail', 'users', 'messages', 'modify',
        '--params', JSON.stringify({ userId: 'me', id: messageId }),
        '--json', JSON.stringify(body),
      ], { account });
      const data = result.data as Record<string, unknown>;
      const labels = (data.labelIds ?? []) as string[];
      return {
        text: `Labels updated on ${messageId}.\n\n**Current labels:** ${labels.join(', ') || '(none)'}` +
          nextSteps('email', 'modify', { email: account }),
        refs: { messageId, labelIds: labels },
      };
    },

    getAttachment: handleGetAttachment,
    viewAttachment: handleViewAttachment,

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
