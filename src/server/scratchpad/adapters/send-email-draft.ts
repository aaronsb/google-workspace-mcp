/**
 * Send adapter: email_draft — creates a Gmail draft from scratchpad content.
 * Uses gws +send --draft for proper MIME construction and attachment support.
 */

import * as path from 'node:path';
import { execute } from '../../../executor/gws.js';
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

  // gws +send requires --to and --subject even for drafts
  const args = [
    'gmail', '+send', '--draft',
    '--to', to || email,
    '--subject', subject || '(draft)',
    '--body', content,
  ];

  // Attach workspace files if scratchpad has attachments
  const attachments = scratchpads.getAttachments(scratchpadId);
  const attachmentPaths = attachments
    ? [...attachments.values()].filter(a => a.location).map(a => a.location)
    : [];
  // gws validates --attach paths are within cwd, so set cwd to workspace dir
  let execOptions: { account: string; cwd?: string } = { account: email };
  if (attachmentPaths.length > 0) {
    const wsDir = getWorkspaceDir();
    for (const p of attachmentPaths) {
      args.push('--attach', path.relative(wsDir, p));
    }
    execOptions = { account: email, cwd: wsDir };
  }

  try {
    const result = await execute(args, execOptions);
    const data = result.data as Record<string, unknown>;
    const draftId = data.id ?? 'unknown';
    const attNote = attachmentPaths.length > 0
      ? `\n**Attachments:** ${attachmentPaths.length}`
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
