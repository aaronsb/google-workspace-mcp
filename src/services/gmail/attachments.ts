/**
 * Gmail attachment handler — downloads email attachments to the workspace directory.
 *
 * The agent discovers attachments via the `read` operation, which lists
 * filenames and sizes. Then calls `getAttachment` with just the messageId
 * and filename — we resolve the attachment ID internally by re-reading
 * the message payload. This keeps long Gmail attachment IDs out of the
 * agent's context.
 *
 * Flow: read → see filenames → getAttachment(messageId, filename) → file in workspace
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execute } from '../../executor/gws.js';
import { requireString } from '../../server/handlers/validate.js';
import { ensureWorkspaceDir, resolveWorkspacePath } from '../../executor/workspace.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

/** Walk message parts recursively to find attachments. */
function findAttachments(parts: unknown[]): Array<{ filename: string; attachmentId: string; mimeType: string; size: number }> {
  const attachments: Array<{ filename: string; attachmentId: string; mimeType: string; size: number }> = [];
  for (const part of parts) {
    const p = part as Record<string, unknown>;
    const filename = p.filename as string | undefined;
    const body = p.body as Record<string, unknown> | undefined;
    const attachmentId = body?.attachmentId as string | undefined;

    if (filename && attachmentId) {
      attachments.push({
        filename,
        attachmentId,
        mimeType: String(p.mimeType ?? ''),
        size: Number(body?.size ?? 0),
      });
    }
    if (Array.isArray(p.parts)) {
      attachments.push(...findAttachments(p.parts as unknown[]));
    }
  }
  return attachments;
}

/**
 * Download an email attachment by filename.
 *
 * Resolves the attachment ID internally by reading the message payload —
 * the agent only needs to provide messageId and filename (from the read response).
 */
export async function handleGetAttachment(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const messageId = requireString(params, 'messageId');
  const filename = requireString(params, 'filename');

  // Ensure workspace directory exists and is valid
  const wsStatus = await ensureWorkspaceDir();
  if (!wsStatus.valid) {
    throw new Error(`Workspace directory invalid: ${wsStatus.warning}`);
  }

  // Read the message to find the attachment ID for this filename
  const msgResult = await execute([
    'gmail', 'users', 'messages', 'get',
    '--params', JSON.stringify({ userId: 'me', id: messageId }),
  ], { account });

  const msg = msgResult.data as Record<string, unknown>;
  const payload = msg.payload as Record<string, unknown> | undefined;
  const allAttachments = payload?.parts ? findAttachments(payload.parts as unknown[]) : [];

  const match = allAttachments.find(a => a.filename === filename);
  if (!match) {
    const available = allAttachments.map(a => a.filename).join(', ') || '(none)';
    throw new Error(
      `Attachment '${filename}' not found in message ${messageId}. ` +
      `Available attachments: ${available}`,
    );
  }

  // Fetch the attachment data
  const result = await execute([
    'gmail', 'users', 'messages', 'attachments', 'get',
    '--params', JSON.stringify({
      userId: 'me',
      messageId,
      id: match.attachmentId,
    }),
  ], { account });

  const data = result.data as Record<string, unknown>;
  const base64Data = String(data.data ?? '');

  if (!base64Data) {
    throw new Error('Attachment data is empty');
  }

  // Decode base64url to buffer
  const base64Standard = base64Data.replace(/-/g, '+').replace(/_/g, '/');
  const buffer = Buffer.from(base64Standard, 'base64');

  // Save to workspace directory (path traversal safe)
  const outputPath = resolveWorkspacePath(filename);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);

  return {
    text: `Attachment saved: **${filename}**\n\n` +
      `**Path:** ${outputPath}\n` +
      `**Size:** ${buffer.length} bytes`,
    refs: {
      filename,
      path: outputPath,
      size: buffer.length,
      messageId,
    },
  };
}
