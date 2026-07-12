/**
 * Send adapter: email_draft — creates a Gmail draft from scratchpad content.
 * sendMail(..., { draft: true }) builds the MIME message and uploads it.
 */

import * as path from 'node:path';
import { sendMail } from '../../../services/gmail/mail.js';
import { getWorkspaceDir } from '../../../executor/workspace.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface EmailDraftTargetParams {
  email: string;
  to?: string;
  subject?: string;
}

export async function sendEmailDraft(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  targetParams: EmailDraftTargetParams,
): Promise<HandlerResponse> {
  const content = scratchpads.getContent(scratchpadId);
  if (content === null) {
    return { text: `Scratchpad ${scratchpadId} not found.`, refs: { error: true } };
  }

  const { email, to, subject } = targetParams;
  if (!email) {
    return {
      text: `Send failed: email (account) is required.\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  // Attach workspace files if the scratchpad has attachments. sendMail() takes
  // workspace-relative names and resolves + path-checks them itself.
  const attachments = scratchpads.getAttachments(scratchpadId);
  const wsDir = getWorkspaceDir();
  const attachmentNames = attachments
    ? [...attachments.values()].filter(a => a.location).map(a => path.relative(wsDir, a.location))
    : [];

  try {
    // A draft still needs To and Subject headers; fall back to the account itself.
    const data = await sendMail(email, {
      to: to || email,
      subject: subject || '(draft)',
      body: content,
      draft: true,
      ...(attachmentNames.length > 0 ? { attachments: attachmentNames } : {}),
    });

    const draftId = data.id ?? 'unknown';
    const attNote = attachmentNames.length > 0
      ? `\n**Attachments:** ${attachmentNames.length}`
      : '';
    return {
      text: `Draft created.\n\n**Draft ID:** ${draftId}${to ? `\n**To:** ${to}` : ''}${subject ? `\n**Subject:** ${subject}` : ''}${attNote}`,
      refs: { scratchpadId, draftId },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}
