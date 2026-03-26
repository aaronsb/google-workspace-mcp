/**
 * Send adapter: email — delivers scratchpad content as an email.
 * When attachments are present, uses MIME builder for multipart message.
 */

import * as fs from 'node:fs/promises';
import { execute } from '../../../executor/gws.js';
import { buildMimeMessage } from '../../../services/gmail/mime.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';
import { nextSteps } from '../../formatting/next-steps.js';

interface EmailTargetParams {
  email: string;
  to: string;
  subject: string;
  cc?: string;
  bcc?: string;
}

export async function sendEmail(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  targetParams: EmailTargetParams,
): Promise<HandlerResponse> {
  const content = scratchpads.getContent(scratchpadId);
  if (content === null) {
    return { text: `Scratchpad ${scratchpadId} not found.`, refs: { error: true } };
  }

  const { email, to, subject, cc, bcc } = targetParams;
  if (!email || !to || !subject) {
    return {
      text: `Send failed: email, to, and subject are required.\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  const attachments = scratchpads.getAttachments(scratchpadId);
  const attachmentRefs = attachments ? [...attachments.values()] : [];
  const hasAttachments = attachmentRefs.some(a => a.location);

  try {
    let data: Record<string, unknown>;

    if (hasAttachments) {
      // Build MIME multipart message with attachments
      const mimeAttachments = await Promise.all(
        attachmentRefs
          .filter(a => a.location)
          .map(async (a) => ({
            filename: a.filename,
            mimeType: a.mimeType,
            content: await fs.readFile(a.location),
          })),
      );

      const raw = buildMimeMessage({
        to, subject, body: content, cc, bcc,
        attachments: mimeAttachments,
      });

      const result = await execute([
        'gmail', 'users', 'messages', 'send',
        '--params', JSON.stringify({
          userId: 'me',
          requestBody: { raw },
        }),
      ], { account: email });
      data = result.data as Record<string, unknown>;
    } else {
      // Simple send without attachments
      const args = ['gmail', '+send', '--to', to, '--subject', subject, '--body', content];
      if (cc) args.push('--cc', cc);
      if (bcc) args.push('--bcc', bcc);
      const result = await execute(args, { account: email });
      data = result.data as Record<string, unknown>;
    }

    const attNote = hasAttachments ? ` (${attachmentRefs.filter(a => a.location).length} attachment(s))` : '';
    return {
      text: `Email sent to ${to}${attNote}.\n\n**Subject:** ${subject}\n**Message ID:** ${data.id ?? 'unknown'}` +
        nextSteps('email', 'send', { email }),
      refs: { scratchpadId, id: data.id, threadId: data.threadId, to, subject },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}
