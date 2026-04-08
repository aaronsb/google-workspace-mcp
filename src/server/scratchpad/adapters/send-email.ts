/**
 * Send adapter: email — delivers scratchpad content as an email.
 * When attachments are present, creates a draft (with --attach and --draft flags)
 * so the agent can review before sending. Without attachments, sends directly.
 */

import * as path from 'node:path';
import { execute } from '../../../executor/gws.js';
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

  const attachments = scratchpads.getAttachments(scratchpadId);
  const attachmentRefs = attachments ? [...attachments.values()] : [];
  const attachmentPaths = attachmentRefs.filter(a => a.location).map(a => a.location);

  try {
    const args = ['gmail', '+send', '--to', to, '--subject', subject, '--body', content];
    if (cc) args.push('--cc', cc);
    if (bcc) args.push('--bcc', bcc);

    // Attachments present → create draft (gws handles MIME + upload endpoint, 35MB limit)
    // gws validates --attach paths are within cwd, so set cwd to workspace dir
    let execOptions: { account: string; cwd?: string } = { account: email };
    if (attachmentPaths.length > 0) {
      const wsDir = getWorkspaceDir();
      args.push('--draft');
      for (const p of attachmentPaths) {
        args.push('--attach', path.relative(wsDir, p));
      }
      execOptions = { account: email, cwd: wsDir };
    }

    const result = await execute(args, execOptions);
    const data = result.data as Record<string, unknown>;

    if (attachmentPaths.length > 0) {
      const attNote = ` (${attachmentPaths.length} attachment(s))`;
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
