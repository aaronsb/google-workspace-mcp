/**
 * Drive patch — domain-specific hooks for the drive service.
 *
 * Key customizations:
 * - Custom formatters for file lists and details
 * - Upload: custom handler with positional file path arg
 * - Download/Export: save to workspace + return inline content for text files
 */

import { execute } from '../../executor/gws.js';
import { formatFileList, formatFileDetail } from '../../server/formatting/markdown.js';
import { nextSteps } from '../../server/formatting/next-steps.js';
import { requireString } from '../../server/handlers/validate.js';
import { saveToWorkspace, formatFileOutput } from '../../executor/file-output.js';
import type { ServicePatch } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

export const drivePatch: ServicePatch = {
  formatList: (data: unknown) => formatFileList(data),
  formatDetail: (data: unknown) => formatFileDetail(data),

  customHandlers: {
    upload: async (params, account): Promise<HandlerResponse> => {
      const filePath = requireString(params, 'filePath');
      const args = ['drive', '+upload', filePath];
      if (params.name) args.push('--name', String(params.name));
      if (params.parentFolderId) args.push('--parent', String(params.parentFolderId));
      const result = await execute(args, { account });
      const data = result.data as Record<string, unknown>;
      return {
        text: `File uploaded: **${data.name ?? filePath}**\n\n**File ID:** ${data.id ?? 'unknown'}` +
          nextSteps('drive', 'upload', { email: account }),
        refs: { id: data.id, fileId: data.id, name: data.name },
      };
    },

    download: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');

      // First get file metadata for the filename
      const metaResult = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, fields: 'name,mimeType' }),
      ], { account });
      const meta = metaResult.data as Record<string, unknown>;
      const filename = String(params.outputPath || meta.name || `file-${fileId}`);
      const mimeType = String(meta.mimeType || '');

      // Download the file content
      const result = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, alt: 'media' }),
      ], { account, format: 'table' }); // table format to get raw content

      const content = String(result.data ?? '');
      const buffer = Buffer.from(content, 'utf-8');

      // Save to workspace + return inline for text files
      const output = await saveToWorkspace(filename, buffer, mimeType);

      return {
        text: formatFileOutput(output) + nextSteps('drive', 'download', { email: account }),
        refs: {
          fileId,
          filename: output.filename,
          path: output.path,
          size: output.size,
          ...(output.content ? { content: output.content } : {}),
        },
      };
    },

    export: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const mimeType = requireString(params, 'mimeType');

      // Determine filename from the export mime type
      const extMap: Record<string, string> = {
        'application/pdf': '.pdf',
        'text/csv': '.csv',
        'text/plain': '.txt',
        'text/html': '.html',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      };
      const ext = extMap[mimeType] || '';

      // Get source file name for the output filename
      const metaResult = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, fields: 'name' }),
      ], { account });
      const meta = metaResult.data as Record<string, unknown>;
      const baseName = String(meta.name || `export-${fileId}`).replace(/\.[^.]+$/, '');
      const filename = String(params.outputPath || `${baseName}${ext}`);

      // Export the file
      const result = await execute([
        'drive', 'files', 'export',
        '--params', JSON.stringify({ fileId, mimeType }),
      ], { account, format: 'table' }); // raw content

      const content = String(result.data ?? '');
      const buffer = Buffer.from(content, 'utf-8');

      const output = await saveToWorkspace(filename, buffer, mimeType);

      return {
        text: formatFileOutput(output) + nextSteps('drive', 'export', { email: account }),
        refs: {
          fileId,
          filename: output.filename,
          path: output.path,
          size: output.size,
          mimeType,
          ...(output.content ? { content: output.content } : {}),
        },
      };
    },
  },
};
