/**
 * MIME message builder for sending emails with attachments via Gmail raw API.
 *
 * Constructs RFC 2822 multipart/mixed messages and base64url-encodes them
 * for the Gmail API's `raw` field. Used when the +send helper can't be used
 * (i.e., when attachments are present).
 */

import { randomUUID } from 'node:crypto';

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface MimeMessageOptions {
  to: string;
  subject: string;
  body: string;
  html?: boolean;
  cc?: string;
  bcc?: string;
  from?: string;
  attachments: MimeAttachment[];
}

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

/** Truncate at first CRLF to prevent MIME header injection. */
function sanitizeHeader(value: string): string {
  const crlfIndex = value.search(/[\r\n]/);
  return crlfIndex === -1 ? value : value.slice(0, crlfIndex);
}

/** Encode a subject line per RFC 2047 if it contains non-ASCII characters. */
function encodeSubject(subject: string): string {
  const safe = sanitizeHeader(subject);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  const encoded = Buffer.from(safe, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

/** Wrap base64 string into 76-character lines per MIME spec. */
function wrapBase64(data: string): string {
  const lines: string[] = [];
  for (let i = 0; i < data.length; i += 76) {
    lines.push(data.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

/** Gmail API maximum raw message size (simple upload). */
const MAX_RAW_SIZE = 5 * 1024 * 1024;

/**
 * Build a MIME multipart/mixed message and return it as a base64url string
 * ready for the Gmail API `raw` field.
 */
export function buildMimeMessage(options: MimeMessageOptions): string {
  const { to, subject, body, html, cc, bcc, from, attachments } = options;
  const boundary = `----=_Part_${randomUUID()}`;

  // Headers (sanitize all values to prevent CRLF injection)
  const headers: string[] = [
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeSubject(subject)}`,
  ];
  if (from) headers.push(`From: ${sanitizeHeader(from)}`);
  if (cc) headers.push(`Cc: ${sanitizeHeader(cc)}`);
  if (bcc) headers.push(`Bcc: ${sanitizeHeader(bcc)}`);

  // Body part
  const bodyContentType = html ? 'text/html; charset=UTF-8' : 'text/plain; charset=UTF-8';
  const bodyBase64 = wrapBase64(Buffer.from(body, 'utf-8').toString('base64'));
  const bodyPart = [
    `--${boundary}`,
    `Content-Type: ${bodyContentType}`,
    `Content-Transfer-Encoding: base64`,
    '',
    bodyBase64,
  ].join('\r\n');

  // Attachment parts (sanitize filenames for MIME headers)
  const attachmentParts = attachments.map(att => {
    const safeName = sanitizeHeader(att.filename).replace(/"/g, '\\"');
    const attBase64 = wrapBase64(att.content.toString('base64'));
    return [
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${safeName}"`,
      `Content-Disposition: attachment; filename="${safeName}"`,
      `Content-Transfer-Encoding: base64`,
      '',
      attBase64,
    ].join('\r\n');
  });

  // Assemble message
  const message = [
    headers.join('\r\n'),
    '',
    bodyPart,
    ...attachmentParts,
    `--${boundary}--`,
  ].join('\r\n');

  // Base64url encode for Gmail API
  const raw = Buffer.from(message, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  if (raw.length > MAX_RAW_SIZE) {
    const sizeMB = (raw.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Message size (${sizeMB}MB) exceeds Gmail's 5MB limit for simple upload. ` +
      `Reduce attachment size or number of attachments.`,
    );
  }

  return raw;
}
