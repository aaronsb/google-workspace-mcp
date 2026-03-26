/**
 * Import adapter: doc — loads a Google Doc into a scratchpad.
 *
 * Two modes:
 * - markdown (default): exports as markdown, strips base64 images to attachments
 * - json: loads native Docs API JSON, sets live binding for round-trip editing
 */

import * as fs from 'node:fs/promises';
import { execute } from '../../../executor/gws.js';
import { resolveWorkspacePath } from '../../../executor/workspace.js';
import { ensureWorkspaceDir } from '../../../executor/workspace.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface DocImportParams {
  email: string;
  documentId: string;
  mode?: 'markdown' | 'json';
}

export async function importDoc(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  sourceParams: DocImportParams,
): Promise<HandlerResponse> {
  const { email, documentId, mode = 'markdown' } = sourceParams;
  if (!email || !documentId) {
    return { text: 'email and documentId are required for doc import.', refs: { error: true } };
  }

  if (mode === 'json') {
    return importDocJson(scratchpads, scratchpadId, email, documentId);
  }

  return importDocMarkdown(scratchpads, scratchpadId, email, documentId);
}

async function importDocMarkdown(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  email: string,
  documentId: string,
): Promise<HandlerResponse> {
  try {
    // Export as markdown via gws docs export
    const result = await execute([
      'docs', '+export',
      '--document', documentId,
      '--mime', 'text/markdown',
    ], { account: email });

    const markdown = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);

    // Strip base64 data URIs, save to workspace, register as attachments
    const { cleanedLines, attachmentCount } = await stripBase64Images(markdown, scratchpads, scratchpadId);

    scratchpads.appendRawLines(scratchpadId, cleanedLines);
    scratchpads.setFormat(scratchpadId, 'markdown');

    const attNote = attachmentCount > 0 ? ` (${attachmentCount} embedded image(s) extracted as attachments)` : '';
    return {
      text: `Imported doc as markdown (${cleanedLines.length} lines) into scratchpad ${scratchpadId}.${attNote}`,
      refs: { scratchpadId, documentId, format: 'markdown', linesImported: cleanedLines.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}

async function importDocJson(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  email: string,
  documentId: string,
): Promise<HandlerResponse> {
  try {
    const result = await execute([
      'docs', 'documents', 'get',
      '--params', JSON.stringify({ documentId }),
    ], { account: email });

    const json = JSON.stringify(result.data, null, 2);
    const lines = json.split('\n');

    scratchpads.appendRawLines(scratchpadId, lines);
    scratchpads.setFormat(scratchpadId, 'json');
    scratchpads.setBinding(scratchpadId, {
      service: 'docs',
      resourceId: documentId,
      account: email,
    });

    return {
      text: `Imported doc as JSON (${lines.length} lines) into scratchpad ${scratchpadId}.\nLive-bound to docs/${documentId} — json_set mutations will apply directly.`,
      refs: { scratchpadId, documentId, format: 'json', linesImported: lines.length, bound: true },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}

/**
 * Strip base64 data URIs from markdown, save images to workspace,
 * and register as attachments in the scratchpad side-table.
 */
async function stripBase64Images(
  markdown: string,
  scratchpads: ScratchpadManager,
  scratchpadId: string,
): Promise<{ cleanedLines: string[]; attachmentCount: number }> {
  // Collect all matches first (can't use async in replace callback)
  const pattern = /!\[([^\]]*)\]\(data:(image\/[^;]+);base64,([A-Za-z0-9+/=\s]+)\)/g;
  const matches: Array<{ full: string; alt: string; mimeType: string; data: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    matches.push({ full: match[0], alt: match[1], mimeType: match[2], data: match[3] });
  }

  if (matches.length === 0) {
    return { cleanedLines: markdown.split('\n'), attachmentCount: 0 };
  }

  await ensureWorkspaceDir();
  let cleaned = markdown;

  for (let i = 0; i < matches.length; i++) {
    const { full, alt, mimeType, data } = matches[i];
    const ext = mimeType.split('/')[1] ?? 'png';
    const filename = `image-${i + 1}.${ext}`;

    // Decode and write to workspace
    const buffer = Buffer.from(data.replace(/\s/g, ''), 'base64');
    const filePath = resolveWorkspacePath(filename);
    await fs.writeFile(filePath, buffer);

    // Register in side-table with real size and location
    scratchpads.attach(scratchpadId, {
      source: 'import',
      filename,
      mimeType,
      size: buffer.length,
      location: filePath,
    });

    const refId = `att-${i + 1}`;
    cleaned = cleaned.replace(full, `![${alt}](att:${refId} "${filename}, ${formatBytes(buffer.length)}, from import")`);
  }

  return { cleanedLines: cleaned.split('\n'), attachmentCount: matches.length };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
