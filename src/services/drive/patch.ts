/**
 * Drive patch — domain-specific hooks for the drive service.
 *
 * Key customizations:
 * - Custom formatters for file lists and details
 * - Upload: custom handler with positional file path arg
 * - Download/Export: save to workspace via gws --output, return inline for text
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execute } from '../../executor/gws.js';
import { formatFileList, formatFileDetail } from '../../server/formatting/markdown.js';
import { nextSteps } from '../../server/formatting/next-steps.js';
import { requireString } from '../../server/handlers/validate.js';
import { ensureWorkspaceDir, resolveWorkspacePath, verifyPathSafety } from '../../executor/workspace.js';
import { isTextFile, formatFileOutput, buildImageBlock, buildImageBlockFromFile, isImageFile, getImageMimeType, type FileOutputResult } from '../../executor/file-output.js';
import type { ServicePatch } from '../../factory/types.js';
import type { HandlerResponse } from '../../server/formatting/markdown.js';

/** Read a file from workspace and build the output result with optional inline content. */
async function readWorkspaceFile(filePath: string, filename: string, mimeType?: string): Promise<FileOutputResult> {
  const stat = await fs.stat(filePath);
  const result: FileOutputResult = {
    filename,
    path: filePath,
    size: stat.size,
  };

  if (isTextFile(filename, mimeType) && stat.size < 100_000) {
    result.content = await fs.readFile(filePath, 'utf-8');
  } else {
    const imageBlock = await buildImageBlockFromFile(filePath, filename, mimeType);
    if (imageBlock) result.imageBlock = imageBlock;
  }

  return result;
}

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

      // Get file metadata for filename and mime type
      const metaResult = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, fields: 'name,mimeType' }),
      ], { account });
      const meta = metaResult.data as Record<string, unknown>;
      const filename = String(params.outputPath || meta.name || `file-${fileId}`);
      const mimeType = String(meta.mimeType || '');

      // Ensure workspace and resolve output path
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      const outputPath = resolveWorkspacePath(filename);
      await verifyPathSafety(outputPath);

      // Download directly to disk via --output (preserves binary integrity)
      await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, alt: 'media' }),
        '--output', outputPath,
      ], { account });

      const output = await readWorkspaceFile(outputPath, filename, mimeType);

      return {
        text: formatFileOutput(output) + nextSteps('drive', 'download', { email: account }),
        refs: {
          fileId,
          filename: output.filename,
          path: output.path,
          size: output.size,
          ...(output.content ? { content: output.content } : {}),
        },
        ...(output.imageBlock ? { content: [output.imageBlock] } : {}),
      };
    },

    viewImage: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');

      // Get file metadata
      const metaResult = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, fields: 'name,mimeType,size' }),
      ], { account });
      const meta = metaResult.data as Record<string, unknown>;
      const filename = String(meta.name || `image-${fileId}`);
      const mimeType = String(meta.mimeType || '');

      if (!isImageFile(filename, mimeType)) {
        throw new Error(`File "${filename}" (${mimeType}) is not a viewable image type`);
      }

      // Download to temp file, read into memory, clean up
      const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tmpPath = path.join(os.tmpdir(), `gws-view-${safeId}-${Date.now()}`);
      try {
        await execute([
          'drive', 'files', 'get',
          '--params', JSON.stringify({ fileId, alt: 'media' }),
          '--output', tmpPath,
        ], { account });

        const buffer = await fs.readFile(tmpPath);
        const imageBlock = buildImageBlock(buffer, filename, mimeType);
        if (!imageBlock) {
          throw new Error(`Image too large to view inline (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Use download instead.`);
        }

        return {
          text: `## ${filename}\n\n**Type:** ${mimeType}\n**Size:** ${buffer.length} bytes\n\n_Image displayed inline below. Use download to save to workspace._`,
          refs: { fileId, filename, mimeType, size: buffer.length },
          content: [imageBlock],
        };
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }
    },

    export: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const mimeType = requireString(params, 'mimeType');

      // Map MIME type to file extension
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

      // Get source file name
      const metaResult = await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, fields: 'name' }),
      ], { account });
      const meta = metaResult.data as Record<string, unknown>;
      const baseName = String(meta.name || `export-${fileId}`).replace(/\.[^.]+$/, '');
      const filename = String(params.outputPath || `${baseName}${ext}`);

      // Ensure workspace and resolve output path
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      const outputPath = resolveWorkspacePath(filename);
      await verifyPathSafety(outputPath);

      // Export directly to disk via --output (preserves binary integrity)
      await execute([
        'drive', 'files', 'export',
        '--params', JSON.stringify({ fileId, mimeType }),
        '--output', outputPath,
      ], { account });

      const output = await readWorkspaceFile(outputPath, filename, mimeType);

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
        ...(output.imageBlock ? { content: [output.imageBlock] } : {}),
      };
    },
  },
};
