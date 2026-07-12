/**
 * Gmail patch — domain-specific hooks for the email service.
 *
 * Key customizations:
 * - Search hydration: messages.list only returns IDs, so we fetch metadata
 * - Custom formatters: pipe-delimited list, header-extracted detail
 * - Custom handlers: send/reply use specific response formatting
 */

import { call } from '../../google/client.js';
import { GoogleApiError } from '../../google/errors.js';
import { formatEmailList, formatEmailDetail, extractBodyFromPayload, decodeSnippet, type EmailBodyFormat } from '../../server/formatting/markdown.js';
import { requireString } from '../../server/handlers/validate.js';
import { handleGetAttachment, handleViewAttachment } from './attachments.js';
import { sendMail, replyMail, forwardMail } from './mail.js';
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
  // Google throttles per USER, not per process, so this burst competes with every
  // other client signed in to the same account. Firing all 50 at once is the surest
  // way to be told no. A modest window is barely slower — the calls still overlap —
  // and it is far less likely to be throttled in the first place.
  return mapLimited(messageIds, HYDRATE_CONCURRENCY, async (msg) => {
    try {
      const data = await call('gmail', 'users.messages.get', {
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      }, { account }) as Record<string, unknown>;
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
    } catch (err) {
      // A message we could not READ must never look like a message with NOTHING IN IT.
      //
      // This used to `catch { return { id: msg.id } }` — every failure became a row
      // with no sender, no subject and no date, indistinguishable from a genuinely
      // empty message. Under rate limiting the tail of an inbox silently rendered as
      // blank lines, and the tool reported success while showing the user nothing.
      //
      // The client retries a 429 now, so reaching here means it did not recover. Say
      // so, in the row, where the person reading the list will actually see it.
      return {
        id: msg.id,
        error: err instanceof GoogleApiError
          ? `could not load (${err.status}${err.reason ? ' ' + err.reason : ''})`
          : `could not load (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  });
}

/** Concurrent, but bounded. */
const HYDRATE_CONCURRENCY = 8;

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);      // fn never rejects — it catches internally
    }
  });
  await Promise.all(workers);
  return results;
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
    const snippet = decodeSnippet(String(t.snippet ?? '')).slice(0, 80);
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
    const snippet = decodeSnippet(String(msg.snippet ?? ''));
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

export const gmailPatch: ServicePatch = {
  afterExecute: {
    // triage IS search, with a different default query. Same raw Google shape
    // (messages.list -> bare ids), same hydrate, same formatter.
    triage: async (result, ctx) => gmailPatch.afterExecute!.search(result, ctx),

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
      default: {
        // `read` accepts an optional bodyFormat — 'plain' (default, current
        // behavior) or 'html' (sanitized HTML for content the text-strip
        // loses; see ADR-305).
        const bodyFormat = (ctx.params.bodyFormat as EmailBodyFormat | undefined) ?? 'plain';
        return formatEmailDetail(data, { bodyFormat });
      }
    }
  },

  customHandlers: {
    /**
     * Forward.
     *
     * We do NOT thread forwards: no In-Reply-To, no References, no threadId. Gmail's
     * own web client starts a new thread, which is what a user means by "forward" —
     * a new conversation with a new audience. Threading it would also drop the
     * forward into the original participants' view of the thread, which is a small
     * privacy surprise.
     */
    forward: async (params, account): Promise<HandlerResponse> => {
      const messageId = requireString(params, 'messageId');
      const to = requireString(params, 'to');
      const includeAttachments = params.includeAttachments !== false
        && params.includeAttachments !== 'false';

      const data = await forwardMail(account, {
        messageId, to,
        body: params.body ? String(params.body) : undefined,
        html: params.html === true || params.html === 'true',
        draft: params.draft === true || params.draft === 'true',
        includeAttachments,
      });

      return {
        text: `Message forwarded to ${to}.\n\n**Message ID:** ${data.id ?? 'unknown'}`,
        refs: { id: data.id, threadId: data.threadId, messageId, to },
      };
    },

    send: async (params, account): Promise<HandlerResponse> => {
      const to = requireString(params, 'to');
      const subject = requireString(params, 'subject');
      const body = requireString(params, 'body');
      const draft = params.draft === true || params.draft === 'true';
      const attachmentNames = params.attachments
        ? String(params.attachments).split(',').map(s => s.trim()).filter(Boolean)
        : [];

      // An attachment forces a draft. That is a SAFETY choice, not a technical
      // limit — the client can send a 35 MB attachment outright (ADR-103 item 4
      // proved it round-trips byte-for-byte). Making it a real send is a product
      // change, and needs to be decided as one.
      const data = await sendMail(account, {
        to, subject, body,
        from: params.from ? String(params.from) : undefined,
        cc: params.cc ? String(params.cc) : undefined,
        bcc: params.bcc ? String(params.bcc) : undefined,
        html: params.html === true || params.html === 'true',
        attachments: attachmentNames,
        draft: draft || attachmentNames.length > 0,
      });

      const attachNote = attachmentNames.length > 0
        ? `\n**Attachments:** ${attachmentNames.join(', ')}`
        : '';

      if (draft || attachmentNames.length > 0) {
        return {
          text: `Draft created for ${to}.\n\n**Subject:** ${subject}${attachNote}\n**Draft ID:** ${data.id ?? 'unknown'}`,
          refs: { id: data.id, draftId: data.id, to, subject, attachments: attachmentNames, isDraft: true },
        };
      }

      return {
        text: `Email sent to ${to}.\n\n**Subject:** ${subject}\n**Message ID:** ${data.id ?? 'unknown'}`,
        refs: { id: data.id, threadId: data.threadId, to, subject },
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

      const data = await call('gmail', 'users.messages.modify', {
        userId: 'me',
        id: messageId,
        ...body,
      }, { account }) as Record<string, unknown>;
      const labels = (data.labelIds ?? []) as string[];
      return {
        text: `Labels updated on ${messageId}.\n\n**Current labels:** ${labels.join(', ') || '(none)'}`,
        refs: { messageId, labelIds: labels },
      };
    },

    getAttachment: handleGetAttachment,
    viewAttachment: handleViewAttachment,

    reply: async (params, account): Promise<HandlerResponse> => {
      const messageId = requireString(params, 'messageId');
      const body = requireString(params, 'body');
      const draft = params.draft === true || params.draft === 'true';
      const attachmentNames = params.attachments
        ? String(params.attachments).split(',').map(s => s.trim()).filter(Boolean)
        : [];

      const data = await replyMail(account, {
        messageId, body,
        html: params.html === true || params.html === 'true',
        attachments: attachmentNames,
        draft: draft || attachmentNames.length > 0,
      });
      const attachNote = attachmentNames.length > 0
        ? `\n**Attachments:** ${attachmentNames.join(', ')}`
        : '';

      if (draft || attachmentNames.length > 0) {
        return {
          text: `Draft reply created.\n\n**Draft ID:** ${data.id ?? 'unknown'}${attachNote}`,
          refs: { id: data.id, draftId: data.id, messageId, attachments: attachmentNames, isDraft: true },
        };
      }

      return {
        text: `Reply sent.\n\n**Message ID:** ${data.id ?? 'unknown'}`,
        refs: { id: data.id, threadId: data.threadId, messageId },
      };
    },

    replyAll: async (params, account): Promise<HandlerResponse> => {
      const messageId = requireString(params, 'messageId');
      const body = requireString(params, 'body');
      const draft = params.draft === true || params.draft === 'true';
      const attachmentNames = params.attachments
        ? String(params.attachments).split(',').map(s => s.trim()).filter(Boolean)
        : [];

      const data = await replyMail(account, {
        messageId, body,
        all: true,                                    // <- the only difference from reply
        cc: params.cc ? String(params.cc) : undefined,
        html: params.html === true || params.html === 'true',
        attachments: attachmentNames,
        draft: draft || attachmentNames.length > 0,
      });
      const attachNote = attachmentNames.length > 0
        ? `\n**Attachments:** ${attachmentNames.join(', ')}`
        : '';

      if (draft || attachmentNames.length > 0) {
        return {
          text: `Draft reply-all created.\n\n**Draft ID:** ${data.id ?? 'unknown'}${attachNote}`,
          refs: { id: data.id, draftId: data.id, messageId, attachments: attachmentNames, isDraft: true },
        };
      }

      return {
        text: `Reply-all sent.\n\n**Message ID:** ${data.id ?? 'unknown'}`,
        refs: { id: data.id, threadId: data.threadId, messageId },
      };
    },
  },
};
