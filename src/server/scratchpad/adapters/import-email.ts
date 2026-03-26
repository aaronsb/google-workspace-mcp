/**
 * Import adapter: email — loads email body text into a scratchpad.
 * Extracts plain text body (or strips HTML as fallback).
 */

import { execute } from '../../../executor/gws.js';
import { extractBodyFromPayload } from '../../formatting/markdown.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface EmailImportParams {
  email: string;
  messageId: string;
}

export async function importEmail(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  sourceParams: EmailImportParams,
): Promise<HandlerResponse> {
  const { email, messageId } = sourceParams;
  if (!email || !messageId) {
    return { text: 'email and messageId are required for email import.', refs: { error: true } };
  }

  try {
    const result = await execute([
      'gmail', 'users', 'messages', 'get',
      '--params', JSON.stringify({ userId: 'me', id: messageId }),
    ], { account: email });

    const msg = result.data as Record<string, unknown>;
    const payload = msg.payload as Record<string, unknown> | undefined;
    const body = extractBodyFromPayload(payload);

    if (!body.trim()) {
      return {
        text: `Email ${messageId} has no text body to import.\nScratchpad ${scratchpadId} unchanged.`,
        refs: { scratchpadId, messageId },
      };
    }

    const lines = body.split('\n');
    scratchpads.appendRawLines(scratchpadId, lines);

    // TODO: Register email file attachments in scratchpad side-table

    return {
      text: `Imported email body (${lines.length} lines) into scratchpad ${scratchpadId}.`,
      refs: { scratchpadId, messageId, linesImported: lines.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}
