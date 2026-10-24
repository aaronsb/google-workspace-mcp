/**
 * Gmail patch — domain-specific hooks for the email service.
 *
 * Key customizations:
 * - Search hydration: messages.list only returns IDs, so we fetch metadata
 * - Custom formatters: pipe-delimited list, header-extracted detail
 * - Custom handlers: send/reply use specific response formatting
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { call } from '../../google/client.js';
import { formatEmailList, formatEmailDetail, extractBodyFromPayload, extractAttachments, decodeSnippet, truncate, formatShortDate, type EmailBodyFormat } from '../../server/formatting/markdown.js';
import { requireString, clamp } from '../../server/handlers/validate.js';
import { ensureWorkspaceDir, resolveWorkspacePath, verifyPathSafety } from '../../executor/workspace.js';
import { handleGetAttachment, handleViewAttachment } from './attachments.js';
import { hydrateMessages, hydrateDrafts } from './hydrate.js';
import {
  handleListFilters, handleGetFilter, handlePreviewFilter,
  handleCreateFilter, handleUpdateFilter, handleDeleteFilter,
} from './filters.js';
import { handlePreviewModifyMatching, handleModifyMatching } from './modify-matching.js';
import { sendMail, replyMail, forwardMail } from './mail.js';
import type { ServicePatch, PatchContext } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

/** "Tue, 19 Aug 2026 ..." -> "2026-08-19"; '' when the header is not parseable. */
const MONTH_TO_MM: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function dateSlug(dateHeader: string): string {
  const m = /(\d{1,2}) ([A-Za-z]{3}) (\d{4})/.exec(dateHeader);
  if (!m) return '';
  const mm = MONTH_TO_MM[m[2]];
  if (!mm) return '';
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

function slugify(value: string, maxLength = 50): string {
  const slug = value
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .toLowerCase();
  return slug || 'email';
}

/** A readable default filename: "<YYYY-MM-DD>_<subject-slug>.md", falling back to the id. */
function defaultArchiveFilename(messageId: string, dateHeader: string, subject: string): string {
  const prefix = dateSlug(dateHeader) || messageId;
  return `${prefix}_${slugify(subject || 'message')}.md`;
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

/**
 * Format draft list — DRAFT id (the id deleteDraft needs), recipient, subject, date.
 *
 * Drafts are their own Gmail resource, so the row's first column is the DRAFT id
 * (the "r…" id), NOT the message id: handing the message id to deleteDraft is how a draft
 * "deletes" without deleting. The refs carry both, keyed so `deleteDraft` can be
 * chained straight off a row (`$0.draftId`).
 */
function formatDraftList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const drafts = (raw?.drafts ?? []) as Array<Record<string, unknown>>;

  if (drafts.length === 0) {
    const hasEstimate = 'resultSizeEstimate' in (raw ?? {});
    const text = hasEstimate
      ? 'No drafts found.'
      : 'No drafts returned. The API response was missing expected fields — this may indicate an authentication or scope issue rather than an empty result.';
    return { text, refs: { count: 0 } };
  }

  const lines = drafts.map(d => {
    const draftId = String(d.draftId ?? '');
    // A draft we FAILED TO FETCH is not a draft with no recipient and no subject.
    // Same rule as the messages list: say what actually happened, in the row.
    if (d.error) return `${draftId} | ⚠ ${String(d.error)}`;
    const to = truncate(String(d.to ?? '(no recipient)'), 40);
    const subject = truncate(String(d.subject ?? '(no subject)'), 50);
    const date = formatShortDate(d.date);
    return `${draftId} | ${to} | ${subject} | ${date}`;
  });

  return {
    text: `## Drafts (${drafts.length})\n\n${lines.join('\n')}`,
    refs: {
      count: drafts.length,
      draftId: String(drafts[0]?.draftId ?? ''),
      draftIds: drafts.map(d => String(d.draftId ?? '')).filter(Boolean),
      messageIds: drafts.map(d => String(d.messageId ?? '')).filter(Boolean),
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

/** Largest page `messages.list` returns; the ids-only page size. */
const IDS_ONLY_PAGE = 500;

function isIdsOnly(ctx: PatchContext): boolean {
  return ctx.operation === 'search' && (ctx.params.idsOnly === true || ctx.params.idsOnly === 'true');
}

/** The paging fields of a Gmail list response, kept through hydration. */
function pagingFrom(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(typeof raw?.nextPageToken === 'string' && raw.nextPageToken ? { nextPageToken: raw.nextPageToken } : {}),
    ...(typeof raw?.resultSizeEstimate === 'number' ? { resultSizeEstimate: raw.resultSizeEstimate } : {}),
  };
}

/**
 * Say when a list stopped before the end (ADR-309).
 *
 * A full page and a complete result look identical otherwise: 50 rows of 50 and 50 rows
 * of 400 render the same, and the reader sizes the problem from the wrong one.
 */
function withPaging(response: HandlerResponse, data: unknown, ctx: PatchContext): HandlerResponse {
  const raw = (data ?? {}) as Record<string, unknown>;
  const nextPageToken = typeof raw.nextPageToken === 'string' ? raw.nextPageToken : '';
  if (!nextPageToken) return response;

  const estimate = typeof raw.resultSizeEstimate === 'number' ? raw.resultSizeEstimate : undefined;
  const sized = estimate !== undefined
    ? ` Google estimates about ${estimate} in total; that figure is an estimate and is often wrong.`
    : '';
  return {
    text: `${response.text}\n\nMore results exist.${sized} Call \`${ctx.operation}\` again with the same parameters and pageToken: ${nextPageToken}`,
    refs: { ...response.refs, nextPageToken, ...(estimate !== undefined ? { resultSizeEstimate: estimate } : {}) },
  };
}

/** An ids-only search page: the ids, comma-separated, ready for bulk_operations batch. */
function formatIdList(data: unknown): HandlerResponse {
  const ids = ((data as Record<string, unknown>)?.ids ?? []) as string[];
  if (ids.length === 0) return { text: 'No messages found.', refs: { count: 0, ids: [] } };
  return {
    text: `## Message ids (${ids.length})\n\n${ids.join(',')}`,
    refs: { count: ids.length, ids },
  };
}

export const gmailPatch: ServicePatch = {
  beforeExecute: {
    // An ids-only page costs one call however long it is, so it pages at the API's own
    // limit rather than at the cap that exists to bound hydration.
    search: (callParams, ctx) => isIdsOnly(ctx)
      ? { ...callParams, maxResults: clamp(ctx.params.maxResults, IDS_ONLY_PAGE, IDS_ONLY_PAGE) }
      : callParams,
  },

  afterExecute: {
    // triage IS search, with a different default query. Same raw Google shape
    // (messages.list -> bare ids), same hydrate, same formatter.
    triage: async (result, ctx) => gmailPatch.afterExecute!.search(result, ctx),

    search: async (result, ctx) => {
      // messages.list returns bare IDs. idsOnly hands them back as they are, which is what
      // makes walking thousands of matches cheap; otherwise each row is hydrated.
      const raw = result as Record<string, unknown>;
      const ids = (raw?.messages ?? []) as Array<{ id: string }>;
      const paging = pagingFrom(raw);
      if (isIdsOnly(ctx)) {
        return { ids: ids.map((m) => m.id), idsOnly: true, ...paging };
      }
      if (ids.length === 0) {
        // Preserve resultSizeEstimate so formatters can distinguish
        // "search ran, no matches" from unexpected empty responses
        return {
          messages: [],
          ...paging,
          resultSizeEstimate: raw?.resultSizeEstimate ?? 0,
          query: ctx.params.query ?? '',
        };
      }
      const messages = await hydrateMessages(ids, ctx.account);
      return { messages, ...paging };
    },

    // users.drafts.list returns bare draft resources ({id, message:{id}}) — hydrate
    // each with metadata so listDrafts shows recipient/subject/date, not just ids.
    listDrafts: async (result, ctx) => {
      const raw = result as Record<string, unknown>;
      const drafts = (raw?.drafts ?? []) as Array<{ id: string; message?: { id?: string; threadId?: string } }>;
      if (drafts.length === 0) {
        return { drafts: [], ...pagingFrom(raw), resultSizeEstimate: raw?.resultSizeEstimate ?? 0 };
      }
      const hydrated = await hydrateDrafts(drafts, ctx.account);
      return { drafts: hydrated, ...pagingFrom(raw) };
    },
  },

  formatList: (data: unknown, ctx: PatchContext) => {
    switch (ctx.operation) {
      case 'labels':
        return formatLabelList(data);
      case 'threads':
        return withPaging(formatThreadList(data), data, ctx);
      case 'listDrafts':
        return withPaging(formatDraftList(data), data, ctx);
      default:
        return withPaging(isIdsOnly(ctx) ? formatIdList(data) : formatEmailList(data), data, ctx);
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
     * Archive. Save one message's headers + plain-text body to a markdown file in the
     * workspace. A LOCAL archive — it reads the message and writes a file, and never
     * touches Gmail's INBOX label (that is `modify` with removeLabelIds: INBOX).
     * Attachments are listed in the file, not downloaded — use `getAttachment` for that.
     */
    archive: async (params, account): Promise<HandlerResponse> => {
      const messageId = requireString(params, 'messageId');

      const data = await call('gmail', 'users.messages.get', {
        userId: 'me',
        id: messageId,
        format: 'full',
      }, { account }) as Record<string, unknown>;

      const payload = data.payload as Record<string, unknown> | undefined;
      const headers = (payload?.headers ?? []) as Array<{ name: string; value: string }>;
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

      const subject = getHeader('subject') || '(no subject)';
      const date = getHeader('date');
      const from = getHeader('from');
      const to = getHeader('to');
      const cc = getHeader('cc');

      const bodyText = extractBodyFromPayload(payload);
      const attachments = payload?.parts ? extractAttachments(payload.parts as unknown[]) : [];

      const filename = params.outputPath
        ? String(params.outputPath)
        : defaultArchiveFilename(messageId, date, subject);

      const doc = [
        `# ${subject}`,
        '',
        `**Message ID:** \`${messageId}\``,
        `**Date:** ${date}`,
        `**From:** ${from}`,
        `**To:** ${to}`,
      ];
      if (cc) doc.push(`**Cc:** ${cc}`);
      if (attachments.length > 0) {
        doc.push(`**Attachments:** ${attachments.map((a) => `${a.filename} (${a.size} bytes)`).join(', ')}`);
      }
      doc.push('', '---', '', bodyText || '(no text body found)', '');

      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      const outputPath = resolveWorkspacePath(filename);
      await verifyPathSafety(outputPath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, doc.join('\n'), 'utf-8');

      return {
        text: `Archived message to **${filename}**\n\n**Message ID:** ${messageId}\n**Path:** ${outputPath}`,
        refs: {
          messageId,
          filename,
          path: outputPath,
          subject,
          from,
          to,
          date,
          attachmentCount: attachments.length,
          attachments: attachments.map((a) => a.filename),
        },
      };
    },

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
      const draft = params.draft === true || params.draft === 'true';

      const data = await forwardMail(account, {
        messageId, to,
        body: params.body ? String(params.body) : undefined,
        html: params.html === true || params.html === 'true',
        draft,
        includeAttachments,
      });

      if (draft) {
        return {
          text: `Draft forward to ${to} saved.\n\n**Draft ID:** ${data.id}`,
          refs: { id: data.id, draftId: data.id, messageId, to, isDraft: true },
        };
      }

      return {
        text: `Message forwarded to ${to}.\n\n**Message ID:** ${data.id}`,
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
          text: `Draft created for ${to}.\n\n**Subject:** ${subject}${attachNote}\n**Draft ID:** ${data.id}`,
          refs: { id: data.id, draftId: data.id, to, subject, attachments: attachmentNames, isDraft: true },
        };
      }

      return {
        text: `Email sent to ${to}.\n\n**Subject:** ${subject}\n**Message ID:** ${data.id}`,
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

    // Filters — the lifecycle and its preview gate live in filters.ts (ADR-309).
    filters: handleListFilters,
    getFilter: handleGetFilter,
    previewFilter: handlePreviewFilter,
    createFilter: handleCreateFilter,
    updateFilter: handleUpdateFilter,
    deleteFilter: handleDeleteFilter,

    // Label changes over a whole query, ids held server-side (ADR-310).
    previewModifyMatching: handlePreviewModifyMatching,
    modifyMatching: handleModifyMatching,

    /**
     * Delete a draft — permanently discard an unsent message.
     *
     * The id is the DRAFT resource id (the "r…" id listDrafts returns). This addresses the draft
     * RESOURCE: a message id from `search in:drafts` is not a draft id, and Google
     * rejects it as not found. Unlike trash there is no undo — Gmail discards drafts,
     * it does not recycle them through the trash, so the confirmation says
     * "deleted" and there is deliberately no untrash step offered after it.
     */
    deleteDraft: async (params, account): Promise<HandlerResponse> => {
      const draftId = requireString(params, 'draftId');
      await call('gmail', 'users.drafts.delete', {
        userId: 'me',
        id: draftId,
      }, { account });
      return {
        text: `Deleted draft **${draftId}**.`,
        refs: { draftId, deleted: true },
      };
    },

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
          text: `Draft reply created.\n\n**Draft ID:** ${data.id}${attachNote}`,
          refs: { id: data.id, draftId: data.id, messageId, attachments: attachmentNames, isDraft: true },
        };
      }

      return {
        text: `Reply sent.\n\n**Message ID:** ${data.id}`,
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
          text: `Draft reply-all created.\n\n**Draft ID:** ${data.id}${attachNote}`,
          refs: { id: data.id, draftId: data.id, messageId, attachments: attachmentNames, isDraft: true },
        };
      }

      return {
        text: `Reply-all sent.\n\n**Message ID:** ${data.id}`,
        refs: { id: data.id, threadId: data.threadId, messageId },
      };
    },
  },
};
