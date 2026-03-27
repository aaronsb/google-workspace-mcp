/**
 * Send adapter: email_draft — creates a Gmail draft from scratchpad content.
 */

import { execute } from '../../../executor/gws.js';
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

  // Build raw RFC 2822 message for drafts.create
  // Strip CRLF to prevent header injection
  const sanitize = (s: string) => s.replace(/[\r\n]/g, '');
  const headers: string[] = [];
  if (to) headers.push(`To: ${sanitize(to)}`);
  if (subject) headers.push(`Subject: ${sanitize(subject)}`);
  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('');
  headers.push(content);
  const raw = Buffer.from(headers.join('\r\n')).toString('base64url');

  try {
    const result = await execute([
      'gmail', 'users', 'drafts', 'create',
      '--params', JSON.stringify({
        userId: 'me',
        requestBody: { message: { raw } },
      }),
    ], { account: email });

    const data = result.data as Record<string, unknown>;
    const draftId = data.id ?? 'unknown';
    return {
      text: `Draft created.\n\n**Draft ID:** ${draftId}${to ? `\n**To:** ${to}` : ''}${subject ? `\n**Subject:** ${subject}` : ''}`,
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
