/**
 * Import adapter: drive_file — loads text content from a Drive file into a scratchpad.
 * Only supports text-based files. Binary files return an error with guidance.
 */

import * as fs from 'node:fs/promises';
import { downloadToWorkspace } from '../../../services/drive/workspace-download.js';
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
    const file = await downloadToWorkspace(fileId, email, {
      accept: ({ name, mimeType }) => {
        if (!TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) {
          throw new Error(
            `File "${name}" is ${mimeType} — not a text format.\n` +
            `Attach it to the scratchpad instead (attach with source "drive").`,
          );
        }
      },
    });

    const content = await fs.readFile(file.path, 'utf-8');
    const lines = content.split('\n');

    scratchpads.appendRawLines(scratchpadId, lines);

    return {
      text: `Imported "${file.name}" (${lines.length} lines) into scratchpad ${scratchpadId}.`,
      refs: { scratchpadId, fileId, filename: file.filename, linesImported: lines.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}
