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
import { ensureWorkspaceDir, getWorkspaceDir, resolveWorkspacePath, verifyPathSafety } from '../../executor/workspace.js';
import { isTextFile, formatFileOutput, buildImageBlock, buildImageBlockFromFile, isImageFile, type FileOutputResult } from '../../executor/file-output.js';
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
        '--params', JSON.stringify({ fileId, fields: 'name,mimeType', supportsAllDrives: true }),
      ], { account });
      const meta = metaResult.data as Record<string, unknown>;
      const filename = String(params.outputPath || meta.name || `file-${fileId}`);
      const mimeType = String(meta.mimeType || '');

      // Ensure workspace and resolve output path
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      const outputPath = resolveWorkspacePath(filename);
      await verifyPathSafety(outputPath);

      // Ensure parent directories exist (outputPath may contain subdirectories)
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Download directly to disk via --output (preserves binary integrity)
      // cwd must match workspace so gws directory-fence accepts the output path
      await execute([
        'drive', 'files', 'get',
        '--params', JSON.stringify({ fileId, alt: 'media', supportsAllDrives: true }),
        '--output', outputPath,
      ], { account, cwd: getWorkspaceDir() });

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
        '--params', JSON.stringify({ fileId, fields: 'name,mimeType,size', supportsAllDrives: true }),
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
          '--params', JSON.stringify({ fileId, alt: 'media', supportsAllDrives: true }),
          '--output', tmpPath,
        ], { account, cwd: path.dirname(tmpPath) });

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
        '--params', JSON.stringify({ fileId, fields: 'name', supportsAllDrives: true }),
      ], { account });
      const meta = metaResult.data as Record<string, unknown>;
      const baseName = String(meta.name || `export-${fileId}`).replace(/\.[^.]+$/, '');
      const filename = String(params.outputPath || `${baseName}${ext}`);

      // Ensure workspace and resolve output path
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      const outputPath = resolveWorkspacePath(filename);
      await verifyPathSafety(outputPath);

      // Ensure parent directories exist (outputPath may contain subdirectories)
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Export directly to disk via --output (preserves binary integrity)
      // cwd must match workspace so gws directory-fence accepts the output path
      await execute([
        'drive', 'files', 'export',
        '--params', JSON.stringify({ fileId, mimeType, supportsAllDrives: true }),
        '--output', outputPath,
      ], { account, cwd: getWorkspaceDir() });

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

    listComments: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const includeDeleted = params.includeDeleted ? 'true' : 'false';

      const result = await execute([
        'drive', 'comments', 'list',
        '--params', JSON.stringify({
          fileId,
          includeDeleted,
          fields: 'comments(id, content, htmlContent, author(displayName, emailAddress), createdTime, modifiedTime, resolved, quotedFileContent, replies(id, content, author(displayName), createdTime)), nextPageToken',
          supportsAllDrives: true,
        }),
      ], { account });
      const data = result.data as Record<string, unknown>;
      const comments = (data.comments || []) as Array<Record<string, unknown>>;

      if (comments.length === 0) {
        return {
          text: 'No comments on this file.' +
            nextSteps('drive', 'listComments', { email: account }),
          refs: { fileId, count: 0 },
        };
      }

      const lines = comments.map((c) => {
        const author = (c.author as Record<string, unknown>)?.displayName || 'Unknown';
        const resolved = c.resolved ? ' [RESOLVED]' : '';
        const quoted = c.quotedFileContent
          ? `\n  > "${(c.quotedFileContent as Record<string, unknown>).value}"`
          : '';
        const replies = (c.replies || []) as Array<Record<string, unknown>>;
        const replyLines = replies.map((r) => {
          const rAuthor = (r.author as Record<string, unknown>)?.displayName || 'Unknown';
          return `  - **${rAuthor}:** ${r.content}`;
        }).join('\n');

        return `- **${author}**${resolved}: ${c.content}${quoted}` +
          (replyLines ? `\n${replyLines}` : '') +
          `\n  _ID: ${c.id}_`;
      });

      return {
        text: `## Comments (${comments.length})\n\n${lines.join('\n\n')}` +
          nextSteps('drive', 'listComments', { email: account }),
        refs: { fileId, count: comments.length },
      };
    },

    getComment: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const commentId = requireString(params, 'commentId');

      const result = await execute([
        'drive', 'comments', 'get',
        '--params', JSON.stringify({
          fileId,
          commentId,
          fields: 'id, content, htmlContent, author(displayName, emailAddress), createdTime, modifiedTime, resolved, quotedFileContent, replies(id, content, htmlContent, author(displayName), createdTime)',
          supportsAllDrives: true,
        }),
      ], { account });
      const c = result.data as Record<string, unknown>;
      const author = (c.author as Record<string, unknown>)?.displayName || 'Unknown';
      const resolved = c.resolved ? ' [RESOLVED]' : '';
      const quoted = c.quotedFileContent
        ? `\n> "${(c.quotedFileContent as Record<string, unknown>).value}"`
        : '';
      const replies = (c.replies || []) as Array<Record<string, unknown>>;
      const replyLines = replies.map((r) => {
        const rAuthor = (r.author as Record<string, unknown>)?.displayName || 'Unknown';
        return `- **${rAuthor}** (${r.createdTime}): ${r.content}`;
      }).join('\n');

      return {
        text: `## Comment by ${author}${resolved}\n\n${c.content}${quoted}\n\n**Created:** ${c.createdTime}\n**Modified:** ${c.modifiedTime}` +
          (replyLines ? `\n\n### Replies\n\n${replyLines}` : '') +
          nextSteps('drive', 'getComment', { email: account }),
        refs: { commentId: c.id, fileId, resolved: c.resolved },
      };
    },

    addComment: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const content = requireString(params, 'content');
      const quotedText = params.quotedText ? String(params.quotedText) : undefined;

      const body: Record<string, unknown> = { content };
      if (quotedText) {
        body.quotedFileContent = { value: quotedText };
      }

      const result = await execute([
        'drive', 'comments', 'create',
        '--params', JSON.stringify({
          fileId,
          fields: 'id, content, htmlContent, author(displayName), createdTime, quotedFileContent',
          supportsAllDrives: true,
        }),
        '--json', JSON.stringify(body),
      ], { account });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Comment added.\n\n**ID:** ${data.id}\n**Content:** ${data.content}` +
          (quotedText ? `\n**Anchored to:** "${quotedText}"` : '') +
          nextSteps('drive', 'addComment', { email: account }),
        refs: { commentId: data.id, fileId },
      };
    },

    resolveComment: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const commentId = requireString(params, 'commentId');
      const resolved = params.resolved !== false;

      // Fetch existing comment to preserve content when updating
      const existing = await execute([
        'drive', 'comments', 'get',
        '--params', JSON.stringify({
          fileId,
          commentId,
          fields: 'content',
          supportsAllDrives: true,
        }),
      ], { account });
      const existingData = existing.data as Record<string, unknown>;

      const result = await execute([
        'drive', 'comments', 'update',
        '--params', JSON.stringify({
          fileId,
          commentId,
          fields: 'id, content, resolved',
          supportsAllDrives: true,
        }),
        '--json', JSON.stringify({
          content: existingData.content || '',
          resolved,
        }),
      ], { account });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Comment ${resolved ? 'resolved' : 'reopened'}.\n\n**ID:** ${data.id}\n**Resolved:** ${resolved}` +
          nextSteps('drive', 'resolveComment', { email: account }),
        refs: { commentId: data.id, fileId, resolved },
      };
    },

    replyToComment: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const commentId = requireString(params, 'commentId');
      const content = requireString(params, 'content');

      const result = await execute([
        'drive', 'replies', 'create',
        '--params', JSON.stringify({
          fileId,
          commentId,
          fields: 'id, content, htmlContent, author(displayName), createdTime',
          supportsAllDrives: true,
        }),
        '--json', JSON.stringify({ content }),
      ], { account });
      const data = result.data as Record<string, unknown>;
      return {
        text: `Reply added.\n\n**ID:** ${data.id}\n**Content:** ${data.content}` +
          nextSteps('drive', 'replyToComment', { email: account }),
        refs: { replyId: data.id, commentId, fileId },
      };
    },
  },
};
