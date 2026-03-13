import { execute } from '../../executor/gws.js';
import { formatFileList } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';
import { requireEmail, requireString, clamp } from './validate.js';

export async function handleDrive(params: Record<string, unknown>): Promise<unknown> {
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
      return { ...formatFileList(result.data), ...nextSteps('drive', 'search') };
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
      return { ...result.data as object, ...nextSteps('drive', 'get', { fileId }) };
    }

    case 'upload': {
      const filePath = requireString(params, 'filePath');
      const args = ['drive', '+upload', filePath];
      if (params.name) args.push('--name', String(params.name));
      if (params.parentFolderId) args.push('--parent', String(params.parentFolderId));
      const result = await execute(args, { account: email });
      return { ...result.data as object, ...nextSteps('drive', 'upload') };
    }

    case 'download': {
      const fileId = requireString(params, 'fileId');
      const args = [
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, alt: 'media' }),
      ];
      if (params.outputPath) args.push('--output', String(params.outputPath));
      await execute(args, { account: email });
      return { status: 'downloaded', fileId, ...nextSteps('drive', 'download') };
    }

    default:
      throw new Error(`Unknown drive operation: ${operation}`);
  }
}
