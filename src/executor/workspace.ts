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
  return configured || DEFAULT_WORKSPACE;
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
 * Resolve a file path within the workspace directory.
 * Prevents path traversal (e.g. ../../etc/passwd).
 */
export function resolveWorkspacePath(filename: string): string {
  const dir = getWorkspaceDir();
  const resolved = path.resolve(dir, filename);

  // Ensure the resolved path is still inside the workspace
  if (!resolved.startsWith(path.resolve(dir) + path.sep) && resolved !== path.resolve(dir)) {
    throw new Error(
      `Path traversal detected: "${filename}" resolves outside workspace directory`,
    );
  }

  return resolved;
}
