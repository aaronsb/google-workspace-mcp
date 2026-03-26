/**
 * Import adapter: drive_file — loads text content from a Drive file into a scratchpad.
 * Only supports text-based files. Binary files return an error with guidance.
 */

import * as fs from 'node:fs/promises';
import { execute } from '../../../executor/gws.js';
import { ensureWorkspaceDir, resolveWorkspacePath } from '../../../executor/workspace.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/x-yaml'];

interface DriveImportParams {
  email: string;
  fileId: string;
}

export async function importDriveFile(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  sourceParams: DriveImportParams,
): Promise<HandlerResponse> {
  const { email, fileId } = sourceParams;
  if (!email || !fileId) {
    return { text: 'email and fileId are required for drive_file import.', refs: { error: true } };
  }

  try {
    // Get file metadata to check type
    const metaResult = await execute([
      'drive', 'files', 'get',
      '--params', JSON.stringify({ fileId, fields: 'id,name,mimeType,size' }),
    ], { account: email });

    const meta = metaResult.data as Record<string, unknown>;
    const mimeType = String(meta.mimeType ?? '');
    const name = String(meta.name ?? fileId);

    const isText = TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p));
    if (!isText) {
      return {
        text: `File "${name}" is ${mimeType} — not a text format.\nUse manage_drive download to get the file, then attach it to the scratchpad instead.`,
        refs: { error: true, scratchpadId, fileId, mimeType },
      };
    }

    // Download to workspace, then read
    await ensureWorkspaceDir();
    await execute([
      'drive', '+download', '--file-id', fileId,
    ], { account: email });

    const filePath = resolveWorkspacePath(name);
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    scratchpads.appendRawLines(scratchpadId, lines);

    return {
      text: `Imported "${name}" (${lines.length} lines) into scratchpad ${scratchpadId}.`,
      refs: { scratchpadId, fileId, filename: name, linesImported: lines.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}
