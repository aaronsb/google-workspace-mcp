import { execute } from '../../executor/gws.js';
import { formatFileList } from '../formatting/markdown.js';
import { nextSteps } from '../formatting/next-steps.js';

export async function handleDrive(params: Record<string, unknown>): Promise<unknown> {
  const operation = params.operation as string;
  const email = params.email as string;

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
      return {
        ...formatFileList(result.data),
        ...nextSteps('drive', 'search'),
      };
    }

    case 'get': {
      if (!params.fileId) throw new Error('fileId is required for get');
      const result = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({
          fileId: params.fileId,
          fields: 'id, name, mimeType, modifiedTime, size, webViewLink, owners, shared',
        }),
      ], { account: email });
      return { ...result.data as object, ...nextSteps('drive', 'get', { fileId: params.fileId as string }) };
    }

    case 'upload': {
      if (!params.filePath) throw new Error('filePath is required for upload');
      const args = ['drive', '+upload', String(params.filePath)];
      if (params.name) args.push('--name', String(params.name));
      if (params.parentFolderId) args.push('--parent', String(params.parentFolderId));
      const result = await execute(args, { account: email });
      return { ...result.data as object, ...nextSteps('drive', 'upload') };
    }

    case 'download': {
      if (!params.fileId) throw new Error('fileId is required for download');
      const args = [
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId: params.fileId, alt: 'media' }),
      ];
      if (params.outputPath) args.push('--output', String(params.outputPath));
      const result = await execute(args, { account: email });
      return { status: 'downloaded', fileId: params.fileId, ...nextSteps('drive', 'download') };
    }

    default:
      throw new Error(`Unknown drive operation: ${operation}`);
  }
}

function clamp(value: unknown, defaultVal: number, max: number): number {
  const n = Number(value) || defaultVal;
  return Math.min(n, max);
}
