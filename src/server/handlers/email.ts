import { execute } from '../../executor/gws.js';
import { formatEmailList, formatEmailDetail } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';

export async function handleEmail(params: Record<string, unknown>): Promise<unknown> {
  const operation = params.operation as string;
  const email = params.email as string;

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
      return {
        ...formatEmailList(result.data),
        ...nextSteps('email', 'search'),
      };
    }

    case 'read': {
      if (!params.messageId) throw new Error('messageId is required for read');
      const result = await execute([
        'gmail', 'users', 'messages', 'get',
        '--params', JSON.stringify({ userId: 'me', id: params.messageId }),
      ], { account: email });
      return {
        ...formatEmailDetail(result.data),
        ...nextSteps('email', 'read', { messageId: params.messageId as string }),
      };
    }

    case 'send': {
      if (!params.to) throw new Error('to is required for send');
      if (!params.subject) throw new Error('subject is required for send');
      if (!params.body) throw new Error('body is required for send');
      const result = await execute([
        'gmail', '+send',
        '--to', String(params.to),
        '--subject', String(params.subject),
        '--body', String(params.body),
      ], { account: email });
      return {
        ...result.data as object,
        ...nextSteps('email', 'send'),
      };
    }

    case 'reply': {
      if (!params.messageId) throw new Error('messageId is required for reply');
      if (!params.body) throw new Error('body is required for reply');
      const result = await execute([
        'gmail', '+reply',
        String(params.messageId),
        '--body', String(params.body),
      ], { account: email });
      return { ...result.data as object, ...nextSteps('email', 'reply') };
    }

    case 'triage': {
      const result = await execute(['gmail', '+triage'], { account: email, format: 'json' });
      return {
        ...formatEmailList(result.data),
        ...nextSteps('email', 'triage'),
      };
    }

    default:
      throw new Error(`Unknown email operation: ${operation}`);
  }
}

function clamp(value: unknown, defaultVal: number, max: number): number {
  const n = Number(value) || defaultVal;
  return Math.min(n, max);
}
