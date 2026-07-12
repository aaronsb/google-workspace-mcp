/**
 * MIME: type lookup, and the RFC 5322 message builder.
 *
 * The builder that used to live here was removed when gws 0.18+ added native
 * `--attach`, and MIME construction moved into the CLI. Retiring gws (ADR-103)
 * means owning it again — it is one of the very few things the facade genuinely
 * did *for* us rather than merely passing through.
 *
 * Two constraints worth stating, because getting either wrong is silent:
 *
 * 1. **Header injection.** A `To:` or `Subject:` carrying CR or LF splits the
 *    header block and lets a caller forge headers (Bcc, From) or inject a body.
 *    Every header value is stripped of control characters. This is not
 *    theoretical: the values come from an LLM, through a tool call.
 *
 * 2. **Inline images belong in multipart/related, not multipart/mixed.** Gmail
 *    rewrites `Content-Disposition: inline` to `attachment` when a CID part sits
 *    in a `mixed` container, so an inline image silently becomes a dangling
 *    attachment. gws learned this the hard way; the comment is in its source.
 */

/** Common extension → MIME type map. Falls back to application/octet-stream. */
const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.js': 'application/javascript',
  '.ts': 'text/x-typescript',
  '.py': 'text/x-python',
  '.sh': 'application/x-sh',
};

/** Look up MIME type by filename extension. */
export function lookupMimeType(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return 'application/octet-stream';
  const ext = filename.slice(dotIndex).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

// --- RFC 5322 message construction ---

const CRLF = '\r\n';

/**
 * Strip CR/LF and other control characters from a header value.
 *
 * A newline in a header value ENDS THE HEADER and starts a new one. A caller who
 * gets `\r\nBcc: attacker@evil.com` into a subject has forged a Bcc. Values here
 * originate from a model's tool call, so this is a real input, not a hypothetical.
 */
function sanitizeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Encode a header value that may contain non-ASCII, per RFC 2047.
 * A bare UTF-8 subject is not legal in a header; Gmail tolerates it, other
 * receivers mangle it. Encode only when needed, so plain subjects stay readable.
 */
function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeader(value);
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf-8').toString('base64')}?=`;
}

/** Wrap base64 at 76 chars, as RFC 2045 requires. */
function wrapBase64(data: Buffer): string {
  return data.toString('base64').replace(/(.{76})/g, `$1${CRLF}`);
}

/**
 * A boundary that cannot collide with the content it delimits.
 *
 * If a boundary string happens to occur inside an attachment's base64 (or inside
 * a body), the message silently truncates at that point. Random suffix, and the
 * marker is not something base64 can produce (it contains `=` only at the end and
 * `_`), so a collision would have to be deliberate.
 */
function makeBoundary(tag: string): string {
  return `----gwsmcp_${tag}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export interface MimeAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
  /** Present for inline images. Forces a multipart/related container — see the header note. */
  contentId?: string;
}

export interface MimeMessage {
  to: string;
  subject: string;
  body: string;
  from?: string;
  cc?: string;
  bcc?: string;
  html?: boolean;
  attachments?: MimeAttachment[];
  /** Threading (reply/forward). */
  inReplyTo?: string;
  references?: string;
}

/**
 * Build an RFC 5322 message, base64url-encoded for Gmail's `raw` field or for a
 * `message/rfc822` media upload.
 *
 * Structure is chosen by content, not by habit:
 *   body only                  -> text/plain or text/html
 *   body + inline images       -> multipart/related   (NOT mixed — Gmail rewrites inline->attachment in mixed)
 *   body + attachments         -> multipart/mixed
 *   body + inline + attachments-> multipart/mixed [ multipart/related [ body, inline… ], attachments… ]
 */
export function buildMimeMessage(msg: MimeMessage): Buffer {
  const headers: string[] = [];
  const add = (name: string, value?: string) => {
    if (value) headers.push(`${name}: ${encodeHeaderValue(value)}`);
  };

  add('From', msg.from);
  add('To', msg.to);
  add('Cc', msg.cc);
  add('Bcc', msg.bcc);
  add('Subject', msg.subject);
  // Message-ID / References must NOT be RFC-2047 encoded — they are addr-spec
  // tokens, not display text. Sanitize only.
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeader(msg.inReplyTo)}`);
  if (msg.references) headers.push(`References: ${sanitizeHeader(msg.references)}`);
  headers.push('MIME-Version: 1.0');

  const bodyType = msg.html ? 'text/html' : 'text/plain';
  const bodyPart = (): string =>
    `Content-Type: ${bodyType}; charset="UTF-8"${CRLF}` +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    wrapBase64(Buffer.from(msg.body, 'utf-8'));

  const attachmentPart = (a: MimeAttachment): string =>
    `Content-Type: ${a.contentType}; name="${sanitizeHeader(a.filename)}"${CRLF}` +
    (a.contentId
      ? `Content-Disposition: inline; filename="${sanitizeHeader(a.filename)}"${CRLF}` +
        `Content-ID: <${sanitizeHeader(a.contentId)}>${CRLF}`
      : `Content-Disposition: attachment; filename="${sanitizeHeader(a.filename)}"${CRLF}`) +
    `Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
    wrapBase64(a.data);

  const all = msg.attachments ?? [];
  const inline = all.filter((a) => a.contentId);
  const files = all.filter((a) => !a.contentId);

  let content: string;

  if (all.length === 0) {
    headers.push(`Content-Type: ${bodyType}; charset="UTF-8"`);
    headers.push('Content-Transfer-Encoding: base64');
    content = wrapBase64(Buffer.from(msg.body, 'utf-8'));
  } else {
    // The body, possibly wrapped with its inline images in a `related` container.
    let bodyBlock: string;
    if (inline.length > 0) {
      const rel = makeBoundary('rel');
      bodyBlock =
        `Content-Type: multipart/related; boundary="${rel}"${CRLF}${CRLF}` +
        `--${rel}${CRLF}${bodyPart()}${CRLF}` +
        inline.map((a) => `--${rel}${CRLF}${attachmentPart(a)}${CRLF}`).join('') +
        `--${rel}--`;
    } else {
      bodyBlock = bodyPart();
    }

    if (files.length === 0) {
      // Inline images only: the related container IS the message.
      const rel = makeBoundary('rel');
      headers.push(`Content-Type: multipart/related; boundary="${rel}"`);
      content =
        `--${rel}${CRLF}${bodyPart()}${CRLF}` +
        inline.map((a) => `--${rel}${CRLF}${attachmentPart(a)}${CRLF}`).join('') +
        `--${rel}--`;
    } else {
      const mixed = makeBoundary('mix');
      headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
      content =
        `--${mixed}${CRLF}${bodyBlock}${CRLF}` +
        files.map((a) => `--${mixed}${CRLF}${attachmentPart(a)}${CRLF}`).join('') +
        `--${mixed}--`;
    }
  }

  return Buffer.from(headers.join(CRLF) + CRLF + CRLF + content + CRLF, 'utf-8');
}

/** Gmail's `raw` field wants base64url with no padding. */
export function toRawField(message: Buffer): string {
  return message.toString('base64url');
}
