/**
 * Import adapter: email — loads email body text into a scratchpad.
 * Extracts plain text body and registers file attachments in the side-table.
 */

import * as fs from 'node:fs/promises';
import { execute } from '../../../executor/gws.js';
import { ensureWorkspaceDir, resolveWorkspacePath } from '../../../executor/workspace.js';
import { extractBodyFromPayload, extractAttachments } from '../../formatting/markdown.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface EmailImportParams {
  email: string;
  messageId: string;
  includeAttachments?: boolean;
}

export async function importEmail(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  sourceParams: EmailImportParams,
): Promise<HandlerResponse> {
  const { email, messageId, includeAttachments = true } = sourceParams;
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

    // Register email file attachments in scratchpad side-table
    let attCount = 0;
    if (includeAttachments && payload?.parts) {
      const emailAttachments = extractAttachments(payload.parts as unknown[]);
      if (emailAttachments.length > 0) {
        await ensureWorkspaceDir();

        for (const att of emailAttachments) {
          try {
            // Download attachment data
            const attResult = await execute([
              'gmail', 'users', 'messages', 'attachments', 'get',
              '--params', JSON.stringify({
                userId: 'me',
                messageId,
                id: att.attachmentId,
              }),
            ], { account: email });

            const attData = attResult.data as Record<string, unknown>;
            const base64Data = String(attData.data ?? '');
            if (!base64Data) continue;

            // Decode and save to workspace
            const buffer = Buffer.from(base64Data, 'base64url');
            const filePath = resolveWorkspacePath(att.filename);
            await fs.writeFile(filePath, buffer);

            // Register in scratchpad
            scratchpads.attach(scratchpadId, {
              source: 'import',
              filename: att.filename,
              mimeType: att.mimeType,
              size: buffer.length,
              location: filePath,
            });
            attCount++;
          } catch {
            // Non-fatal: skip individual attachment failures
          }
        }
      }
    }

    const attNote = attCount > 0 ? ` with ${attCount} attachment(s)` : '';
    return {
      text: `Imported email body (${lines.length} lines)${attNote} into scratchpad ${scratchpadId}.`,
      refs: { scratchpadId, messageId, linesImported: lines.length, attachmentsImported: attCount },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Import failed: ${message}`,
      refs: { error: true, scratchpadId },
    };
  }
}
