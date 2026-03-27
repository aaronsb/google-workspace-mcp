/**
 * Gmail attachment handler — downloads or views email attachments.
 *
 * The agent discovers attachments via the `read` operation, which lists
 * filenames and sizes. Then calls `getAttachment` to save to workspace,
 * or `viewAttachment` to view images inline without saving.
 *
 * Flow: read → see filenames → getAttachment/viewAttachment(messageId, filename)
 */

import { execute } from '../../executor/gws.js';
import { requireString } from '../../server/handlers/validate.js';
import { saveToWorkspace, formatFileOutput, isImageFile, buildImageBlock, getImageMimeType } from '../../executor/file-output.js';
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

/** Fetch raw attachment data by messageId and filename. Returns the buffer and metadata. */
async function fetchAttachmentData(
  messageId: string,
  filename: string,
  account: string,
): Promise<{ buffer: Buffer; match: { filename: string; attachmentId: string; mimeType: string; size: number } }> {
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

  return { buffer, match };
}

/**
 * Download an email attachment by filename — saves to workspace.
 */
export async function handleGetAttachment(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const messageId = requireString(params, 'messageId');
  const filename = requireString(params, 'filename');

  const { buffer, match } = await fetchAttachmentData(messageId, filename, account);
  const output = await saveToWorkspace(filename, buffer, match.mimeType);

  return {
    text: formatFileOutput(output),
    refs: {
      filename: output.filename,
      path: output.path,
      size: output.size,
      messageId,
      ...(output.content ? { content: output.content } : {}),
    },
    ...(output.imageBlock ? { content: [output.imageBlock] } : {}),
  };
}

/**
 * View an image attachment inline without saving to workspace.
 */
export async function handleViewAttachment(
  params: Record<string, unknown>,
  account: string,
): Promise<HandlerResponse> {
  const messageId = requireString(params, 'messageId');
  const filename = requireString(params, 'filename');

  const { buffer, match } = await fetchAttachmentData(messageId, filename, account);

  if (!isImageFile(filename, match.mimeType)) {
    throw new Error(
      `"${filename}" (${match.mimeType}) is not a viewable image type. ` +
      `Use getAttachment to download it instead.`,
    );
  }

  const imageBlock = buildImageBlock(buffer, filename, match.mimeType);
  if (!imageBlock) {
    throw new Error(
      `Image too large to view inline (${(buffer.length / 1024 / 1024).toFixed(1)} MB). ` +
      `Use getAttachment to download it instead.`,
    );
  }

  return {
    text: `## ${filename}\n\n**Type:** ${getImageMimeType(filename, match.mimeType)}\n**Size:** ${buffer.length} bytes\n\n_Image displayed inline below. Use getAttachment to save to workspace._`,
    refs: { filename, messageId, mimeType: match.mimeType, size: buffer.length },
    content: [imageBlock],
  };
}
