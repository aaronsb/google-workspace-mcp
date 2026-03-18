/**
 * Drive patch — domain-specific hooks for the drive service.
 *
 * Key customizations:
 * - Custom formatters for file lists and details
 * - Upload: custom handler with positional file path arg
 * - Download: custom handler with output path and alt=media
 */

import { execute } from '../../executor/gws.js';
import { formatFileList, formatFileDetail } from '../../server/formatting/markdown.js';
import { nextSteps } from '../../server/formatting/next-steps.js';
import { requireString } from '../../server/handlers/validate.js';
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
      const args = [
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, alt: 'media' }),
      ];
      if (params.outputPath) args.push('--output', String(params.outputPath));
      await execute(args, { account });
      return {
        text: `File downloaded: ${fileId}` +
          (params.outputPath ? ` → ${params.outputPath}` : '') +
          nextSteps('drive', 'download', { email: account }),
        refs: { fileId, status: 'downloaded' },
      };
    },
  },
};
