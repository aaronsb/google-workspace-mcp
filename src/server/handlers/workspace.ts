/**
 * Workspace handler — file CRUD within the sandboxed workspace directory.
 *
 * The workspace is the exchange point between the MCP server and the agent.
 * Files saved by getAttachment, download, and export land here. The agent
 * can also read, write, and manage files directly — including nested directories.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { ensureWorkspaceDir, resolveWorkspacePath, verifyPathSafety, getWorkspaceDir, sanitizePath } from '../../executor/workspace.js';
import { isTextFile, buildImageBlockFromFile } from '../../executor/file-output.js';
import type { HandlerResponse } from '../formatting/markdown.js';

/** Recursively list files under a directory, returning relative paths. Skips symlinks that escape the workspace. */
async function listRecursive(root: string, subdir: string = ''): Promise<{ relativePath: string; size: number; isDir: boolean }[]> {
  const entries: { relativePath: string; size: number; isDir: boolean }[] = [];
  const dirPath = subdir ? path.join(root, subdir) : root;
  const resolvedRoot = path.resolve(root);

  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return entries;
    throw err;
  }

  for (const dirent of dirents) {
    const rel = subdir ? path.join(subdir, dirent.name) : dirent.name;
    const fullPath = path.join(root, rel);

    // Verify symlinks don't escape the workspace
    try {
      const real = await fs.realpath(fullPath);
      if (!real.startsWith(resolvedRoot + path.sep) && real !== resolvedRoot) continue;
    } catch {
      continue; // Skip broken symlinks
    }

    if (dirent.isDirectory()) {
      entries.push({ relativePath: rel, size: 0, isDir: true });
      const children = await listRecursive(root, rel);
      entries.push(...children);
    } else {
      const stat = await fs.stat(fullPath);
      entries.push({ relativePath: rel, size: stat.size, isDir: false });
    }
  }

  return entries;
}

/** Format a size value for display. */
function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

export async function handleWorkspace(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;

  switch (operation) {
    case 'list': {
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) {
        return { text: `Workspace invalid: ${wsStatus.warning}`, refs: { valid: false } };
      }

      const dir = getWorkspaceDir();

      // Optional subdirectory scope
      let listRoot = dir;
      if (params.path) {
        const subPath = sanitizePath(String(params.path));
        listRoot = path.join(dir, subPath);
        await verifyPathSafety(listRoot);
      }

      const entries = await listRecursive(listRoot);

      if (entries.length === 0) {
        const label = listRoot === dir ? 'Workspace' : `${path.relative(dir, listRoot)}/`;
        return {
          text: `## ${label} (empty)\n\n**Path:** ${listRoot}`,
          refs: { count: 0, path: listRoot },
        };
      }

      const lines = entries.map(e => {
        const indent = '  '.repeat(e.relativePath.split(path.sep).length - 1);
        const label = path.basename(e.relativePath);
        const suffix = e.isDir ? '/' : ` (${formatSize(e.size)})`;
        return `${indent}- ${label}${suffix}`;
      });

      const fileCount = entries.filter(e => !e.isDir).length;
      const dirCount = entries.filter(e => e.isDir).length;
      const summary = [
        `${fileCount} file${fileCount !== 1 ? 's' : ''}`,
        ...(dirCount > 0 ? [`${dirCount} director${dirCount !== 1 ? 'ies' : 'y'}`] : []),
      ].join(', ');

      return {
        text: `## Workspace (${summary})\n\n**Path:** ${listRoot}\n\n${lines.join('\n')}`,
        refs: {
          count: entries.length,
          files: fileCount,
          directories: dirCount,
          path: listRoot,
          entries: entries.map(e => e.relativePath),
        },
      };
    }

    case 'read': {
      const filename = params.filename as string;
      if (!filename) throw new Error('filename is required');

      const filePath = resolveWorkspacePath(filename);
      await verifyPathSafety(filePath);
      const stat = await fs.stat(filePath);

      // Try image block first (up to 5MB)
      const imageBlock = await buildImageBlockFromFile(filePath, filename);
      if (imageBlock) {
        return {
          text: `## ${filename}\n\n**Path:** ${filePath}\n**Size:** ${stat.size} bytes\n\n_Image included inline below._`,
          refs: { filename, path: filePath, size: stat.size },
          content: [imageBlock],
        };
      }

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

      // Prevent deleting the workspace root itself
      const wsRoot = path.resolve(getWorkspaceDir());
      if (path.resolve(filePath) === wsRoot) {
        throw new Error('Cannot delete the workspace root directory');
      }

      const stat = await fs.lstat(filePath);

      // If it's a symlink, just unlink it (don't follow)
      if (stat.isSymbolicLink()) {
        await fs.unlink(filePath);
        return {
          text: `Symlink deleted: **${filename}**`,
          refs: { filename, status: 'deleted', type: 'symlink' },
        };
      }

      if (stat.isDirectory()) {
        // Verify no symlinks inside escape the workspace before recursive delete
        const resolvedRoot = path.resolve(getWorkspaceDir());
        const verifyTreeSafety = async (dir: string): Promise<void> => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            const real = await fs.realpath(entryPath);
            if (!real.startsWith(resolvedRoot + path.sep) && real !== resolvedRoot) {
              throw new Error(`Cannot delete: "${entry.name}" links outside workspace`);
            }
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
              await verifyTreeSafety(entryPath);
            }
          }
        };
        await verifyTreeSafety(filePath);

        await fs.rm(filePath, { recursive: true });
        return {
          text: `Directory deleted: **${filename}/**`,
          refs: { filename, status: 'deleted', type: 'directory' },
        };
      }

      await fs.unlink(filePath);

      return {
        text: `File deleted: **${filename}**`,
        refs: { filename, status: 'deleted', type: 'file' },
      };
    }

    case 'move': {
      const source = params.source as string;
      const destination = params.destination as string;
      if (!source) throw new Error('source is required');
      if (!destination) throw new Error('destination is required');

      const srcPath = resolveWorkspacePath(source);
      const destPath = resolveWorkspacePath(destination);
      await verifyPathSafety(srcPath);
      await verifyPathSafety(destPath);

      // Ensure destination parent exists
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.rename(srcPath, destPath);

      return {
        text: `Moved: **${source}** → **${destination}**\n\n**Path:** ${destPath}`,
        refs: { source, destination, path: destPath },
      };
    }

    case 'mkdir': {
      const dirName = (params.path as string) || (params.filename as string);
      if (!dirName) throw new Error('path is required');

      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) {
        throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      }

      const dirPath = resolveWorkspacePath(dirName);
      await verifyPathSafety(dirPath);
      await fs.mkdir(dirPath, { recursive: true, mode: 0o755 });

      return {
        text: `Directory created: **${dirName}/**\n\n**Path:** ${dirPath}`,
        refs: { path: dirPath, name: dirName },
      };
    }

    case 'compress': {
      const filename = params.filename as string;
      if (!filename) throw new Error('filename is required');

      const srcPath = resolveWorkspacePath(filename);
      await verifyPathSafety(srcPath);

      const outputName = (params.destination as string) || `${filename}.gz`;
      const destPath = resolveWorkspacePath(outputName);
      await verifyPathSafety(destPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      const buffer = await fs.readFile(srcPath);
      const compressed = await promisify(gzip)(buffer);
      await fs.writeFile(destPath, compressed);

      const ratio = buffer.length > 0
        ? ((1 - compressed.length / buffer.length) * 100).toFixed(1)
        : '0';

      return {
        text: `Compressed: **${filename}** → **${outputName}**\n\n` +
          `**Original:** ${formatSize(buffer.length)}\n` +
          `**Compressed:** ${formatSize(compressed.length)} (${ratio}% reduction)\n` +
          `**Path:** ${destPath}`,
        refs: {
          filename: outputName,
          path: destPath,
          originalSize: buffer.length,
          compressedSize: compressed.length,
          source: filename,
        },
      };
    }

    case 'decompress': {
      const filename = params.filename as string;
      if (!filename) throw new Error('filename is required');

      const srcPath = resolveWorkspacePath(filename);
      await verifyPathSafety(srcPath);

      // Default output: strip .gz extension, or append .out
      const defaultOutput = filename.endsWith('.gz')
        ? filename.slice(0, -3)
        : `${filename}.out`;
      const outputName = (params.destination as string) || defaultOutput;
      const destPath = resolveWorkspacePath(outputName);
      await verifyPathSafety(destPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      const buffer = await fs.readFile(srcPath);
      const decompressed = await promisify(gunzip)(buffer);
      await fs.writeFile(destPath, decompressed);

      return {
        text: `Decompressed: **${filename}** → **${outputName}**\n\n` +
          `**Compressed:** ${formatSize(buffer.length)}\n` +
          `**Decompressed:** ${formatSize(decompressed.length)}\n` +
          `**Path:** ${destPath}`,
        refs: {
          filename: outputName,
          path: destPath,
          compressedSize: buffer.length,
          decompressedSize: decompressed.length,
          source: filename,
        },
      };
    }

    default:
      throw new Error(`Unknown workspace operation: ${operation}`);
  }
}
