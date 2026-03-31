import { execute } from '../../executor/gws.js';
import { formatFileList, formatFileDetail } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';
import { requireEmail, requireString, clamp } from './validate.js';
import type { HandlerResponse } from '../handler.js';

export async function handleDrive(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;
  const email = requireEmail(params);

  switch (operation) {
    case 'search': {
      const result = await execute([
        'drive', 'files', 'list',
        '--params', JSON.stringify({
          q: params.query || undefined,
          pageSize: clamp(params.maxResults, 10, 50),
          fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink)',
        }),
      ], { account: email });
      const formatted = formatFileList(result.data);
      return {
        text: formatted.text + nextSteps('drive', 'search', { email }),
        refs: formatted.refs,
      };
    }

    case 'get': {
      const fileId = requireString(params, 'fileId');
      const result = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({
          fileId,
          fields: 'id, name, mimeType, modifiedTime, size, webViewLink, owners, shared',
        }),
      ], { account: email });
      const formatted = formatFileDetail(result.data);
      return {
        text: formatted.text + nextSteps('drive', 'get', { email, fileId }),
        refs: formatted.refs,
      };
    }

    case 'upload': {
      const filePath = requireString(params, 'filePath');
      const args = ['drive', '+upload', filePath];
      if (params.name) args.push('--name', String(params.name));
      if (params.parentFolderId) args.push('--parent', String(params.parentFolderId));
      const result = await execute(args, { account: email });
      const data = result.data as Record<string, unknown>;
      return {
        text: `File uploaded: **${data.name ?? filePath}**\n\n**File ID:** ${data.id ?? 'unknown'}` +
          nextSteps('drive', 'upload', { email }),
        refs: { id: data.id, fileId: data.id, name: data.name },
      };
    }

    default:
      throw new Error(`Unknown drive operation: ${operation}`);
  }
}
