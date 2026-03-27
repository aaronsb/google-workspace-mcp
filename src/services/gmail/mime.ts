/**
 * MIME type lookup utility.
 *
 * The MIME message builder that used to live here was removed when gws 0.18+
 * added native --attach support to mail helpers. MIME construction is now
 * handled by the gws CLI directly.
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
