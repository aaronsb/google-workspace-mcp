import { execute } from '../../executor/gws.js';
import { formatEmailList, formatEmailDetail } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';
import { requireEmail, requireString, clamp } from './validate.js';
import type { HandlerResponse } from '../handler.js';

export async function handleEmail(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;
  const email = requireEmail(params);

  switch (operation) {
    case 'search': {
      const result = await execute([
        'gmail', 'users', 'messages', 'list',
        '--params', JSON.stringify({
          userId: 'me',
          q: params.query || '',
          maxResults: clamp(params.maxResults, 10, 50),
        }),
      ], { account: email });
      const formatted = formatEmailList(result.data);
      return {
        text: formatted.text + nextSteps('email', 'search', { email }),
        refs: formatted.refs,
      };
    }

    case 'read': {
      const messageId = requireString(params, 'messageId');
      const result = await execute([
        'gmail', 'users', 'messages', 'get',
        '--params', JSON.stringify({ userId: 'me', id: messageId }),
      ], { account: email });
      const formatted = formatEmailDetail(result.data);
      return {
        text: formatted.text + nextSteps('email', 'read', { email, messageId }),
        refs: formatted.refs,
      };
    }

    case 'send': {
      const to = requireString(params, 'to');
      const subject = requireString(params, 'subject');
      const body = requireString(params, 'body');
      const result = await execute([
        'gmail', '+send',
        '--to', to, '--subject', subject, '--body', body,
      ], { account: email });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Email sent to ${to}.\n\n**Subject:** ${subject}\n**Message ID:** ${data.id ?? 'unknown'}` +
          nextSteps('email', 'send', { email }),
        refs: { id: data.id, threadId: data.threadId, to, subject },
      };
    }

    case 'reply': {
      const messageId = requireString(params, 'messageId');
      const body = requireString(params, 'body');
      const result = await execute([
        'gmail', '+reply', messageId, '--body', body,
      ], { account: email });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Reply sent.\n\n**Message ID:** ${data.id ?? 'unknown'}` +
          nextSteps('email', 'reply', { email }),
        refs: { id: data.id, threadId: data.threadId, messageId },
      };
    }

    case 'triage': {
      const result = await execute(['gmail', '+triage'], { account: email, format: 'json' });
      const formatted = formatEmailList(result.data);
      return {
        text: formatted.text + nextSteps('email', 'triage', { email }),
        refs: formatted.refs,
      };
    }

    default:
      throw new Error(`Unknown email operation: ${operation}`);
  }
}
