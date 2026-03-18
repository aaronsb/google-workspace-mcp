/**
 * Workspace handler — file CRUD within the sandboxed workspace directory.
 *
 * The workspace is the exchange point between the MCP server and the agent.
 * Files saved by getAttachment, download, and export land here. The agent
 * can also read, write, and manage files directly.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureWorkspaceDir, resolveWorkspacePath, verifyPathSafety, getWorkspaceDir } from '../../executor/workspace.js';
import { isTextFile } from '../../executor/file-output.js';
import type { HandlerResponse } from '../formatting/markdown.js';

export async function handleWorkspace(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;

  switch (operation) {
    case 'list': {
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) {
        return { text: `Workspace invalid: ${wsStatus.warning}`, refs: { valid: false } };
      }

      const dir = getWorkspaceDir();
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        files = [];
      }

      if (files.length === 0) {
        return {
          text: `## Workspace (empty)\n\n**Path:** ${dir}`,
          refs: { count: 0, path: dir },
        };
      }

      const entries = await Promise.all(files.map(async (name) => {
        const filePath = path.join(dir, name);
        const stat = await fs.stat(filePath);
        const size = stat.isDirectory() ? 'dir' :
          stat.size < 1024 ? `${stat.size} B` :
          `${(stat.size / 1024).toFixed(1)} KB`;
        return `${name} (${size})`;
      }));

      return {
        text: `## Workspace (${files.length} files)\n\n**Path:** ${dir}\n\n${entries.map((e, i) => `${i + 1}. ${e}`).join('\n')}`,
        refs: { count: files.length, path: dir, files },
      };
    }

    case 'read': {
      const filename = params.filename as string;
      if (!filename) throw new Error('filename is required');

      const filePath = resolveWorkspacePath(filename);
      await verifyPathSafety(filePath);
      const stat = await fs.stat(filePath);

      if (stat.size > 100_000) {
        return {
          text: `File too large to return inline (${(stat.size / 1024).toFixed(1)} KB). Use the file path directly:\n\n**Path:** ${filePath}`,
          refs: { filename, path: filePath, size: stat.size },
        };
      }

      const buffer = await fs.readFile(filePath);

      if (isTextFile(filename)) {
        const content = buffer.toString('utf-8');
        const safeContent = content.replace(/```/g, '` ` `');
        return {
          text: `## ${filename}\n\n\`\`\`\n${safeContent}\n\`\`\``,
          refs: { filename, path: filePath, size: stat.size, content },
        };
      }

      return {
        text: `Binary file: **${filename}** (${(stat.size / 1024).toFixed(1)} KB)\n\n**Path:** ${filePath}`,
        refs: { filename, path: filePath, size: stat.size },
      };
    }

    case 'write': {
      const filename = params.filename as string;
      const content = params.content as string;
      if (!filename) throw new Error('filename is required');
      if (content === undefined) throw new Error('content is required');

      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) {
        throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      }

      const filePath = resolveWorkspacePath(filename);
      await verifyPathSafety(filePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');

      return {
        text: `File written: **${filename}** (${Buffer.byteLength(content)} bytes)\n\n**Path:** ${filePath}`,
        refs: { filename, path: filePath, size: Buffer.byteLength(content) },
      };
    }

    case 'delete': {
      const filename = params.filename as string;
      if (!filename) throw new Error('filename is required');

      const filePath = resolveWorkspacePath(filename);
      await verifyPathSafety(filePath);
      await fs.unlink(filePath);

      return {
        text: `File deleted: **${filename}**`,
        refs: { filename, status: 'deleted' },
      };
    }

    default:
      throw new Error(`Unknown workspace operation: ${operation}`);
  }
}
