/**
 * Response formatters — shape raw gws JSON into token-efficient
 * markdown for AI consumption.
 *
 * Design:
 * - Lists are compact and scannable (pipe-delimited, IDs included)
 * - Detail views are natural prose an agent can relay to a user
 * - Each formatter returns { text, refs } where refs are the
 *   structured values queue $N.field resolution needs
 */

/** MCP content block for inline image/audio return. */
export interface ContentBlock {
  type: 'image' | 'audio';
  data: string;       // base64-encoded
  mimeType: string;
}

/** Shared response shape — markdown text for agents, structured refs for queue $N.field. */
export interface HandlerResponse {
  text: string;
  refs: Record<string, unknown>;
  /** Optional content blocks (images, audio) returned alongside text. */
  content?: ContentBlock[];
}

// --- Email body extraction ---

import { sanitizeHtmlForAgent } from './html-sanitize.js';

export type EmailBodyFormat = 'plain' | 'html';

/**
 * Walk Gmail MIME payload parts to extract the message body.
 *
 * `format: 'plain'` (default) — prefers `text/plain`, falls back to a lossy
 *   `stripHtml()` on `text/html`. Existing behavior.
 * `format: 'html'` — prefers `text/html` and returns it sanitized + wrapped
 *   in a Spotlighting block (ADR-305). Falls back to the `text/plain` part
 *   if no HTML exists.
 *
 * Decodes base64url body data either way.
 */
export function extractBodyFromPayload(
  payload: Record<string, unknown> | undefined,
  format: EmailBodyFormat = 'plain',
): string {
  if (!payload) return '';

  // Simple (non-multipart) message — body is directly on payload
  const body = payload.body as Record<string, unknown> | undefined;
  if (body?.data && !payload.parts) {
    const decoded = decodeBase64Url(String(body.data));
    const mimeType = String(payload.mimeType ?? '');
    if (format === 'html' && mimeType === 'text/html') {
      return sanitizeHtmlForAgent(decoded, { source: 'gmail' });
    }
    if (format === 'plain' && mimeType === 'text/html') {
      return stripHtml(decoded);
    }
    return decoded;
  }

  // Multipart — walk parts tree
  const parts = payload.parts as Array<Record<string, unknown>> | undefined;
  if (!parts || parts.length === 0) return '';

  if (format === 'html') {
    const html = findPart(parts, 'text/html');
    if (html) return sanitizeHtmlForAgent(html, { source: 'gmail' });
    const plain = findPart(parts, 'text/plain');
    if (plain) return plain;
    return '';
  }

  // 'plain' — prefer text/plain, fall back to stripped HTML
  const plain = findPart(parts, 'text/plain');
  if (plain) return plain;

  const html = findPart(parts, 'text/html');
  if (html) return stripHtml(html);

  return '';
}

function findPart(parts: Array<Record<string, unknown>>, mimeType: string): string | null {
  for (const part of parts) {
    if (String(part.mimeType ?? '') === mimeType) {
      const body = part.body as Record<string, unknown> | undefined;
      if (body?.data) return decodeBase64Url(String(body.data));
    }
    // Recurse into nested multipart
    if (Array.isArray(part.parts)) {
      const found = findPart(part.parts as Array<Record<string, unknown>>, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function decodeBase64Url(data: string): string {
  // Gmail uses base64url encoding (RFC 4648 §5)
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Max body size before we show snippet + size hint instead. ~12k tokens (~50KB). */
const MAX_BODY_TOKENS = 12_000;

/**
 * Decide whether to show full body or snippet preview.
 * Default: full body. Only truncates when body is very large (>~50KB)
 * to protect the LLM context window from unexpectedly huge emails.
 */
function chooseBodyContent(
  snippet: string,
  fullBody: string,
  messageId: string,
): { text: string; truncated: boolean; fullBodyTokens: number } {
  if (!fullBody) {
    return { text: snippet, truncated: false, fullBodyTokens: 0 };
  }

  const tokens = estimateTokens(fullBody);

  if (tokens <= MAX_BODY_TOKENS) {
    return { text: fullBody, truncated: false, fullBodyTokens: tokens };
  }

  // Large email — show snippet with size info so the LLM can decide
  return {
    text: `${snippet}\n\n` +
      `> **Full message is ~${tokens.toLocaleString()} tokens (${(fullBody.length / 1024).toFixed(0)} KB).** ` +
      `Showing snippet only. To read the full body, re-read message \`${messageId}\` with \`fullBody: true\`.`,
    truncated: true,
    fullBodyTokens: tokens,
  };
}

// --- Email formatting ---

export function formatEmailList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const messages = (raw?.messages ?? raw?.items ?? []) as Record<string, unknown>[];

  if (messages.length === 0) {
    const hasEstimate = 'resultSizeEstimate' in (raw ?? {});
    const query = raw?.query ? ` for query: "${raw.query}"` : '';
    const text = hasEstimate
      ? `No messages found${query}.`
      : `No messages returned. The API response was missing expected fields — this may indicate an authentication or scope issue rather than an empty result.`;
    return { text, refs: { count: 0, apiResponseValid: hasEstimate } };
  }

  const lines = messages.map(msg => {
    const id = String(msg.id ?? '');
    const from = truncate(String(msg.from ?? ''), 30);
    const subject = truncate(String(msg.subject ?? '(no subject)'), 50);
    const date = formatShortDate(msg.date);
    return `${id} | ${from} | ${subject} | ${date}`;
  });

  const text = `## Messages (${messages.length})\n\n${lines.join('\n')}`;
  const firstId = String(messages[0]?.id ?? '');

  return {
    text,
    refs: {
      count: messages.length,
      messageId: firstId,
      messages: messages.map(m => String(m.id ?? '')),
    },
  };
}

/** Extract attachments from message payload parts (recursive). */
export function extractAttachments(parts: unknown[]): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];
  for (const part of parts) {
    const p = part as Record<string, unknown>;
    const filename = p.filename as string | undefined;
    const body = p.body as Record<string, unknown> | undefined;
    const attachmentId = body?.attachmentId as string | undefined;

    if (filename && attachmentId) {
      attachments.push({
        filename,
        mimeType: String(p.mimeType ?? ''),
        size: Number(body?.size ?? 0),
        attachmentId,
      });
    }

    // Recurse into nested parts
    if (Array.isArray(p.parts)) {
      attachments.push(...extractAttachments(p.parts as unknown[]));
    }
  }
  return attachments;
}

export function formatEmailDetail(
  data: unknown,
  options: { bodyFormat?: EmailBodyFormat } = {},
): HandlerResponse {
  const msg = data as Record<string, unknown>;
  const payload = msg.payload as Record<string, unknown> | undefined;
  const headers = (payload?.headers ?? []) as Array<{ name: string; value: string }>;

  const getHeader = (name: string) =>
    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const id = String(msg.id ?? '');
  const from = getHeader('from');
  const to = getHeader('to');
  const subject = getHeader('subject');
  const date = getHeader('date');
  const labels = (msg.labelIds ?? []) as string[];
  const snippet = String(msg.snippet ?? '');
  const bodyFormat: EmailBodyFormat = options.bodyFormat ?? 'plain';
  const fullBody = extractBodyFromPayload(payload, bodyFormat);

  const parts: string[] = [
    `## ${subject || '(no subject)'}`,
    '',
    `**From:** ${from}`,
    `**To:** ${to}`,
    `**Date:** ${date}`,
  ];

  if (labels.length > 0) {
    parts.push(`**Labels:** ${labels.join(', ')}`);
  }

  // Extract and display attachments
  const attachments = payload?.parts ? extractAttachments(payload.parts as unknown[]) : [];
  if (attachments.length > 0) {
    parts.push('', `**Attachments (${attachments.length}):**`);
    attachments.forEach((att, i) => {
      const size = att.size < 1024 ? `${att.size} B` : `${(att.size / 1024).toFixed(1)} KB`;
      parts.push(`${i + 1}. ${att.filename} (${size})`);
    });
  }

  // Show snippet preview when body is significantly larger, with token estimate
  const bodyContent = chooseBodyContent(snippet, fullBody, id);
  parts.push('', bodyContent.text);

  return {
    text: parts.join('\n'),
    refs: {
      id,
      threadId: String(msg.threadId ?? ''),
      messageId: id,
      from,
      to,
      subject,
      bodyTruncated: bodyContent.truncated,
      fullBodyTokens: bodyContent.fullBodyTokens,
      attachments: attachments.map(a => ({
        filename: a.filename,
        attachmentId: a.attachmentId,
        mimeType: a.mimeType,
        size: a.size,
      })),
    },
  };
}

// --- Calendar formatting ---

export function formatEventList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.items ?? []) as Record<string, unknown>[];

  if (items.length === 0) {
    return { text: 'No events found.', refs: { count: 0 } };
  }

  const lines = items.map(event => {
    const id = String(event.id ?? '');
    const summary = String(event.summary ?? '(no title)');
    const start = formatEventTime(event.start);
    const end = formatEventTime(event.end);
    const timeRange = formatTimeRange(start, end);
    const location = event.location ? ` | ${event.location}` : '';
    const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : 0;
    const attendees = attendeeCount > 0 ? ` | ${attendeeCount} attendee${attendeeCount > 1 ? 's' : ''}` : '';
    const marker = eventMarker(start);
    return `${marker} ${timeRange} | ${summary}${location}${attendees} _(${id})_`;
  });

  const text = `## Events (${items.length})\n\n${lines.join('\n')}`;

  return {
    text,
    refs: {
      count: items.length,
      eventId: String(items[0]?.id ?? ''),
      events: items.map(e => String(e.id ?? '')),
    },
  };
}

export function formatEventDetail(data: unknown): HandlerResponse {
  const event = data as Record<string, unknown>;
  const attendees = (event.attendees ?? []) as Array<Record<string, unknown>>;
  const id = String(event.id ?? '');
  const summary = String(event.summary ?? '(no title)');
  const start = formatEventTime(event.start);
  const end = formatEventTime(event.end);
  const location = event.location ? String(event.location) : undefined;
  const description = event.description ? String(event.description) : undefined;
  const organizer = (event.organizer as Record<string, unknown>)?.email as string | undefined;

  const meetLink = (event.conferenceData as Record<string, unknown>)?.entryPoints
    ? ((event.conferenceData as Record<string, unknown>).entryPoints as Array<Record<string, unknown>>)
        .find(e => e.entryPointType === 'video')?.uri as string | undefined
    : undefined;

  const parts: string[] = [
    `## ${summary}`,
    '',
    `**When:** ${formatTimeRange(start, end)}`,
  ];

  if (location) parts.push(`**Where:** ${location}`);
  if (organizer) parts.push(`**Organizer:** ${organizer}`);
  if (meetLink) parts.push(`**Meet:** ${meetLink}`);

  if (attendees.length > 0) {
    parts.push('', '**Attendees:**');
    for (const a of attendees) {
      const status = a.responseStatus === 'accepted' ? '[x]'
                   : a.responseStatus === 'declined' ? '[-]'
                   : '[ ]';
      parts.push(`- ${status} ${a.email}`);
    }
  }

  if (description) {
    parts.push('', description);
  }

  return {
    text: parts.join('\n'),
    refs: {
      id,
      eventId: id,
      summary,
      start,
      end,
      organizer,
      meetLink,
    },
  };
}

// --- Drive formatting ---

export function formatFileList(data: unknown): HandlerResponse {
  const raw = data as Record<string, unknown>;
  const items = (raw?.files ?? []) as Record<string, unknown>[];

  if (items.length === 0) {
    return { text: 'No files found.', refs: { count: 0 } };
  }

  const lines = items.map(file => {
    const id = String(file.id ?? '');
    const name = truncate(String(file.name ?? ''), 40);
    const type = shortMimeType(String(file.mimeType ?? ''));
    const modified = formatShortDate(file.modifiedTime);
    const size = file.size ? humanSize(Number(file.size)) : '';
    return `${id} | ${name} | ${type} | ${modified}${size ? ' | ' + size : ''}`;
  });

  const text = `## Files (${items.length})\n\n${lines.join('\n')}`;

  return {
    text,
    refs: {
      count: items.length,
      fileId: String(items[0]?.id ?? ''),
      files: items.map(f => String(f.id ?? '')),
    },
  };
}

export function formatFileDetail(data: unknown): HandlerResponse {
  const file = data as Record<string, unknown>;
  const id = String(file.id ?? '');
  const name = String(file.name ?? '');
  const mimeType = String(file.mimeType ?? '');
  const modified = String(file.modifiedTime ?? '');
  const size = file.size ? humanSize(Number(file.size)) : undefined;
  const webViewLink = file.webViewLink ? String(file.webViewLink) : undefined;
  const owners = (file.owners ?? []) as Array<Record<string, unknown>>;
  const shared = Boolean(file.shared);

  const parts: string[] = [
    `## ${name}`,
    '',
    `**Type:** ${mimeType}`,
    `**Modified:** ${modified}`,
  ];

  if (size) parts.push(`**Size:** ${size}`);
  if (webViewLink) parts.push(`**Link:** ${webViewLink}`);
  if (owners.length > 0) {
    parts.push(`**Owner:** ${owners.map(o => o.emailAddress ?? o.displayName).join(', ')}`);
  }
  parts.push(`**Shared:** ${shared ? 'yes' : 'no'}`);

  return {
    text: parts.join('\n'),
    refs: { id, fileId: id, name, mimeType },
  };
}

// --- Helpers ---

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatShortDate(value: unknown): string {
  if (!value) return '';
  const s = String(value);
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

function formatEventTime(time: unknown): string {
  if (!time) return '';
  const t = time as Record<string, string>;
  return t.dateTime ?? t.date ?? '';
}

function formatTimeRange(start: string, end: string): string {
  if (!start) return '';
  try {
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    if (isNaN(s.getTime())) return `${start} – ${end}`;

    const sTime = s.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const sDate = s.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    if (!e || isNaN(e.getTime())) return `${sDate} ${sTime}`;

    const eTime = e.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Same day: "Mon, Mar 14 09:00–09:30"
    if (s.toDateString() === e.toDateString()) {
      return `${sDate} ${sTime}–${eTime}`;
    }
    // Different days
    const eDate = e.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `${sDate} ${sTime} – ${eDate} ${eTime}`;
  } catch {
    return `${start} – ${end}`;
  }
}

function eventMarker(start: string): string {
  if (!start) return '[ ]';
  try {
    const d = new Date(start);
    if (isNaN(d.getTime())) return '[ ]';
    return d.getTime() < Date.now() ? '[x]' : '[ ]';
  } catch {
    return '[ ]';
  }
}

function shortMimeType(mime: string): string {
  if (mime.startsWith('application/vnd.google-apps.')) {
    return mime.replace('application/vnd.google-apps.', 'g/');
  }
  // "application/pdf" → "pdf", "text/plain" → "text"
  const parts = mime.split('/');
  if (parts.length === 2) {
    return parts[1] === 'octet-stream' ? 'binary' : parts[1];
  }
  return mime;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
