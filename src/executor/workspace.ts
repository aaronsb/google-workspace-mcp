/**
 * Workspace directory — safe sandbox for file I/O operations.
 *
 * All file operations (Drive upload/download, Docs export, Sheets CSV export)
 * are jailed to this directory. Prevents agents from accidentally operating on
 * home directories, document folders, or Google Drive mount points.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { dataDir } from './paths.js';

const DEFAULT_WORKSPACE = path.join(dataDir(), 'workspace');

/** Paths that must never be used as the workspace root. */
const FORBIDDEN_PATHS = [
  // Home directory itself
  () => process.env.HOME ?? '',
  () => process.env.USERPROFILE ?? '',
  // Common document directories (only when HOME/USERPROFILE is set)
  () => process.env.HOME ? path.join(process.env.HOME, 'Documents') : '',
  () => process.env.HOME ? path.join(process.env.HOME, 'Desktop') : '',
  () => process.env.HOME ? path.join(process.env.HOME, 'Downloads') : '',
  // Windows equivalents
  () => process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents') : '',
  () => process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : '',
  () => process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : '',
];

/** Path substrings that indicate a Google Drive mount. */
const GDRIVE_PATTERNS = [
  'google-drive',
  'Google Drive',
  'GoogleDrive',
  'gdrive',
  'My Drive',
];

/** Validate and return the workspace directory path. */
export function getWorkspaceDir(): string {
  const configured = process.env.WORKSPACE_DIR;
  // Ignore unresolved mcpb template variables (e.g. "${user_config.workspace_dir}")
  if (configured && !configured.includes('${')) {
    return configured;
  }
  return DEFAULT_WORKSPACE;
}

/**
 * Validate workspace dir is safe. Throws if it IS a protected directory.
 * Being a subdirectory OF a protected directory is fine (e.g. ~/Documents/mcp-workspace/).
 */
export function validateWorkspaceDir(dir: string): void {
  const resolved = path.resolve(dir);

  // Must not BE a protected directory (subdirectories are OK)
  for (const getForbidden of FORBIDDEN_PATHS) {
    const forbidden = getForbidden();
    if (forbidden && path.resolve(forbidden) === resolved) {
      throw new Error(
        `Workspace directory cannot be ${resolved} itself — ` +
        `use a subdirectory like ${resolved}/mcp-workspace or ${DEFAULT_WORKSPACE}`,
      );
    }
  }

  // Check for Google Drive mount points
  for (const pattern of GDRIVE_PATTERNS) {
    if (resolved.toLowerCase().includes(pattern.toLowerCase())) {
      throw new Error(
        `Workspace directory cannot be inside a Google Drive mount (${resolved}) — ` +
        `this could cause sync conflicts and data loss`,
      );
    }
  }

  // Must not be the filesystem root
  if (resolved === '/' || resolved === 'C:\\') {
    throw new Error('Workspace directory cannot be the filesystem root');
  }
}

export interface WorkspaceStatus {
  path: string;
  valid: boolean;
  warning?: string;
}

/** Check workspace directory status without crashing. */
export function checkWorkspaceStatus(): WorkspaceStatus {
  const dir = getWorkspaceDir();
  try {
    validateWorkspaceDir(dir);
    return { path: dir, valid: true };
  } catch (err) {
    return {
      path: dir,
      valid: false,
      warning: (err as Error).message,
    };
  }
}

/** Ensure the workspace directory exists and is validated. Returns status instead of throwing. */
export async function ensureWorkspaceDir(): Promise<WorkspaceStatus> {
  const status = checkWorkspaceStatus();
  if (status.valid) {
    await fs.mkdir(status.path, { recursive: true, mode: 0o755 });
  }
  return status;
}

/**
 * Sanitize a filename from external sources (email attachments, Drive metadata).
 * Strips null bytes, control characters, path separators, and other dangerous chars.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    // Remove null bytes and control characters
    .replace(/[\x00-\x1f\x7f]/g, '')
    // Remove path separators (prevent directory traversal via filename)
    .replace(/[/\\]/g, '_')
    // Remove other potentially dangerous characters
    .replace(/[<>:"|?*]/g, '_')
    // Collapse multiple underscores
    .replace(/_+/g, '_')
    // Remove leading dots (hidden files) and trailing dots/spaces (Windows)
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    // Fallback if nothing remains
    || 'unnamed';
}

/**
 * Resolve a file path within the workspace directory.
 * Prevents path traversal (e.g. ../../etc/passwd) and sanitizes the filename.
 */
export function resolveWorkspacePath(filename: string): string {
  const dir = getWorkspaceDir();
  const sanitized = sanitizeFilename(filename);
  const resolved = path.resolve(dir, sanitized);

  // Ensure the resolved path is still inside the workspace
  const resolvedDir = path.resolve(dir);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    throw new Error(
      `Path traversal detected: "${filename}" resolves outside workspace directory`,
    );
  }

  return resolved;
}

/**
 * Verify a file path is safe to read/write after symlink resolution.
 * Must be called before any fs operation on a workspace path.
 */
export async function verifyPathSafety(filePath: string): Promise<void> {
  const dir = path.resolve(getWorkspaceDir());
  try {
    const real = await fs.realpath(filePath);
    if (!real.startsWith(dir + path.sep) && real !== dir) {
      throw new Error(
        `Symlink escape detected: "${filePath}" resolves to "${real}" outside workspace`,
      );
    }
  } catch (err) {
    // ENOENT is OK — file doesn't exist yet (write case)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}
