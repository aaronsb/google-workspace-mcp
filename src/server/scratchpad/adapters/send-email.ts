/**
 * Send adapter: email — delivers scratchpad content as an email.
 * Attachments from the side-table are included as file attachments.
 */

import { execute } from '../../../executor/gws.js';
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

  const args = ['gmail', '+send', '--to', to, '--subject', subject, '--body', content];
  if (cc) args.push('--cc', cc);
  if (bcc) args.push('--bcc', bcc);

  // TODO: Resolve attachments from side-table and include as --attachment flags

  try {
    const result = await execute(args, { account: email });
    const data = result.data as Record<string, unknown>;
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
