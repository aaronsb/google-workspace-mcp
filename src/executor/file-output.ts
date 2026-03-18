/**
 * File output utility — saves files to workspace and returns content inline
 * when possible. Solves the containerization problem: agents running in
 * sandboxed environments (Claude Desktop) can't read the MCP server's
 * local filesystem, so text content must be included in the response.
 *
 * Used by: getAttachment (gmail), download (drive), export (drive)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureWorkspaceDir, resolveWorkspacePath, verifyPathSafety } from './workspace.js';

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

const MAX_INLINE_SIZE = 100_000; // 100KB — larger text files are saved only

/** Check if a file should have its content returned inline. */
export function isTextFile(filename: string, mimeType?: string): boolean {
  if (mimeType && TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return true;
  const ext = path.extname(filename).toLowerCase();
  return TEXT_EXTENSIONS.includes(ext);
}

export interface FileOutputResult {
  filename: string;
  path: string;
  size: number;
  /** Text content included inline for containerized agents. Undefined for binary files. */
  content?: string;
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
  }

  return parts.join('\n');
}
