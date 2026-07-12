/**
 * Send adapter: email — delivers scratchpad content as an email.
 * When attachments are present, creates a draft so the agent can review before
 * sending. Without attachments, sends directly.
 */

import * as path from 'node:path';
import { sendMail } from '../../../services/gmail/mail.js';
import { getWorkspaceDir } from '../../../executor/workspace.js';
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

  // sendMail() takes WORKSPACE-RELATIVE names — it resolves and path-safety-checks
  // them itself (that fence replaced gws's cwd fence). The side-table stores
  // absolute locations, so relativise them here.
  const attachments = scratchpads.getAttachments(scratchpadId);
  const wsDir = getWorkspaceDir();
  const attachmentNames = attachments
    ? [...attachments.values()].filter(a => a.location).map(a => path.relative(wsDir, a.location))
    : [];

  try {
    // Attachments present → draft, so the agent can review before it goes out.
    const isDraft = attachmentNames.length > 0;
    const data = await sendMail(email, {
      to,
      subject,
      body: content,
      cc,
      bcc,
      ...(isDraft ? { draft: true, attachments: attachmentNames } : {}),
    });

    if (isDraft) {
      const attNote = ` (${attachmentNames.length} attachment(s))`;
      return {
        text: `Draft created for ${to}${attNote}.\n\n**Subject:** ${subject}\n**Draft ID:** ${data.id ?? 'unknown'}\n\n` +
          `_Draft with attachments saved to Gmail. Review and send from Gmail or use manage_email to send the draft._` +
          nextSteps('email', 'draft', { email }),
        refs: { scratchpadId, id: data.id, draftId: data.id, to, subject, isDraft: true },
      };
    }

    return {
      text: `Email sent to ${to}.\n\n**Subject:** ${subject}\n**Message ID:** ${data.id ?? 'unknown'}` +
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
