/**
 * Import adapter: doc — loads a Google Doc into a scratchpad.
 *
 * Two modes:
 * - markdown (default): exports as markdown, strips base64 images to attachments
 * - json: loads native Docs API JSON, sets live binding for round-trip editing
 */

import { execute } from '../../../executor/gws.js';
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

    // Strip base64 data URIs and register as attachment references
    const { cleanedLines, attachmentCount } = stripBase64Images(markdown, scratchpads, scratchpadId);

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
 * Strip base64 data URIs from markdown and replace with attachment markers.
 * Registers each extracted image in the scratchpad attachment side-table.
 */
function stripBase64Images(
  markdown: string,
  scratchpads: ScratchpadManager,
  scratchpadId: string,
): { cleanedLines: string[]; attachmentCount: number } {
  let attachmentCount = 0;

  // Match ![alt](data:image/...;base64,...) patterns
  const cleaned = markdown.replace(
    /!\[([^\]]*)\]\(data:(image\/[^;]+);base64,[A-Za-z0-9+/=\s]+\)/g,
    (_match, alt: string, mimeType: string) => {
      attachmentCount++;
      const refId = `att-${attachmentCount}`;
      const filename = `image-${attachmentCount}.${mimeType.split('/')[1] ?? 'png'}`;

      // Register in side-table (location is empty — image was inline, not on disk)
      // TODO: Write base64 data to workspace file and set location
      scratchpads.attach(scratchpadId, {
        source: 'import',
        filename,
        mimeType,
        size: 0, // Unknown until extracted to file
        location: '',
      });

      // Return the marker (attach() also inserts a marker line, so we return just the alt ref)
      return `![${alt}](att:${refId} "${filename}, from import")`;
    },
  );

  return { cleanedLines: cleaned.split('\n'), attachmentCount };
}
