/**
 * File output utility — saves files to workspace and returns content inline
 * when possible. Solves the containerization problem: agents running in
 * sandboxed environments (Claude Desktop) can't read the MCP server's
 * local filesystem, so text content must be included in the response.
 *
 * Used by: getAttachment (gmail), download (drive), export (drive), workspace read
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureWorkspaceDir, resolveWorkspacePath, verifyPathSafety } from './workspace.js';
import type { ContentBlock } from '../server/formatting/markdown.js';

/** MIME types and extensions considered text-safe for inline return. */
const TEXT_MIME_PREFIXES = [
  'text/', 'application/json', 'application/xml', 'application/javascript',
  'application/x-yaml', 'application/toml', 'application/csv',
];

const TEXT_EXTENSIONS = [
  '.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.xml', '.html',
  '.htm', '.eml', '.log', '.ini', '.toml', '.js', '.ts', '.py',
  '.sh', '.bash', '.zsh', '.css', '.svg',
];

/** Image MIME types supported by MCP image content blocks. */
const IMAGE_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

const MAX_INLINE_SIZE = 100_000; // 100KB — larger text files are saved only
const MAX_IMAGE_SIZE = 5_000_000; // 5MB — larger images are path-only

/** Check if a file should have its content returned inline. */
export function isTextFile(filename: string, mimeType?: string): boolean {
  if (mimeType && TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return true;
  const ext = path.extname(filename).toLowerCase();
  return TEXT_EXTENSIONS.includes(ext);
}

/** Check if a file is an image that can be returned as an MCP image block. */
export function isImageFile(filename: string, mimeType?: string): boolean {
  if (mimeType && mimeType.startsWith('image/')) return true;
  const ext = path.extname(filename).toLowerCase();
  return ext in IMAGE_MIME_MAP;
}

/** Get the image MIME type for a filename or explicit MIME. */
export function getImageMimeType(filename: string, mimeType?: string): string {
  if (mimeType && mimeType.startsWith('image/')) return mimeType;
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_MIME_MAP[ext] ?? 'image/png';
}

/** Build an MCP image content block from a buffer. Returns undefined if too large. */
export function buildImageBlock(buffer: Buffer, filename: string, mimeType?: string): ContentBlock | undefined {
  if (buffer.length > MAX_IMAGE_SIZE) return undefined;
  return {
    type: 'image',
    data: buffer.toString('base64'),
    mimeType: getImageMimeType(filename, mimeType),
  };
}

/** Build an MCP image content block from a file on disk. Returns undefined if not an image or too large. */
export async function buildImageBlockFromFile(filePath: string, filename: string, mimeType?: string): Promise<ContentBlock | undefined> {
  if (!isImageFile(filename, mimeType)) return undefined;
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_IMAGE_SIZE) return undefined;
  const buffer = await fs.readFile(filePath);
  return buildImageBlock(buffer, filename, mimeType);
}

export interface FileOutputResult {
  filename: string;
  path: string;
  size: number;
  /** Text content included inline for containerized agents. Undefined for binary files. */
  content?: string;
  /** Image content block for visual files. */
  imageBlock?: ContentBlock;
}

/**
 * Save a buffer to the workspace directory and optionally return text content inline.
 */
export async function saveToWorkspace(
  filename: string,
  buffer: Buffer,
  mimeType?: string,
): Promise<FileOutputResult> {
  const wsStatus = await ensureWorkspaceDir();
  if (!wsStatus.valid) {
    throw new Error(`Workspace directory invalid: ${wsStatus.warning}`);
  }

  const outputPath = resolveWorkspacePath(filename);
  await verifyPathSafety(outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);

  const result: FileOutputResult = {
    filename,
    path: outputPath,
    size: buffer.length,
  };

  if (isTextFile(filename, mimeType) && buffer.length < MAX_INLINE_SIZE) {
    result.content = buffer.toString('utf-8');
  } else if (isImageFile(filename, mimeType)) {
    result.imageBlock = buildImageBlock(buffer, filename, mimeType);
  }

  return result;
}

/** Format a file output result as markdown for the MCP response. */
export function formatFileOutput(result: FileOutputResult): string {
  const parts = [
    `**${result.filename}** saved to workspace`,
    '',
    `**Path:** ${result.path}`,
    `**Size:** ${result.size} bytes`,
  ];

  if (result.content) {
    // Escape any triple backticks in the content to prevent markdown fence injection
    const safeContent = result.content.replace(/```/g, '` ` `');
    parts.push('', '---', '', '```', safeContent, '```');
  } else if (result.imageBlock) {
    parts.push('', '_Image included inline below._');
  }

  return parts.join('\n');
}
