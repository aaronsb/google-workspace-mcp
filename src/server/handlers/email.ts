import { execute } from '../../executor/gws.js';
import { formatEmailList, formatEmailDetail } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';
import { requireEmail, requireString, clamp } from './validate.js';

export async function handleEmail(params: Record<string, unknown>): Promise<unknown> {
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
      return { ...formatEmailList(result.data), ...nextSteps('email', 'search') };
    }

    case 'read': {
      const messageId = requireString(params, 'messageId');
      const result = await execute([
        'gmail', 'users', 'messages', 'get',
        '--params', JSON.stringify({ userId: 'me', id: messageId }),
      ], { account: email });
      return { ...formatEmailDetail(result.data), ...nextSteps('email', 'read', { messageId }) };
    }

    case 'send': {
      const to = requireString(params, 'to');
      const subject = requireString(params, 'subject');
      const body = requireString(params, 'body');
      const result = await execute([
        'gmail', '+send',
        '--to', to, '--subject', subject, '--body', body,
      ], { account: email });
      return { ...result.data as object, ...nextSteps('email', 'send') };
    }

    case 'reply': {
      const messageId = requireString(params, 'messageId');
      const body = requireString(params, 'body');
      const result = await execute([
        'gmail', '+reply', messageId, '--body', body,
      ], { account: email });
      return { ...result.data as object, ...nextSteps('email', 'reply') };
    }

    case 'triage': {
      const result = await execute(['gmail', '+triage'], { account: email, format: 'json' });
      return { ...formatEmailList(result.data), ...nextSteps('email', 'triage') };
    }

    default:
      throw new Error(`Unknown email operation: ${operation}`);
  }
}
