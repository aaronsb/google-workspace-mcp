/**
 * Drive → workspace download — the one path that brings a Drive file's bytes onto disk.
 *
 * `manage_drive download`, scratchpad `import drive_file` and scratchpad `attach` with
 * source `drive` all land here, so the file ID only ever reaches the Drive API and the
 * file on disk always sits inside the workspace.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { call, download } from '../../google/client.js';
import {
  ensureWorkspaceDir, getWorkspaceDir, resolveWorkspacePath, sanitizeFilename, verifyPathSafety,
} from '../../executor/workspace.js';

/** Google-native types (Docs, Sheets, folders…) have no bytes to download, only exports. */
const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';

export interface DriveFileMeta {
  name: string;
  mimeType: string;
}

export interface WorkspaceDownload extends DriveFileMeta {
  /** Workspace-relative name the file was written under. */
  filename: string;
  /** Absolute path inside the workspace. */
  path: string;
}

export interface DownloadOptions {
  /** Workspace-relative destination chosen by the caller. Defaults to the Drive name. */
  outputPath?: string;
  /** Throws to refuse a file from its metadata, before any bytes are fetched. */
  accept?: (meta: DriveFileMeta) => void;
}

export async function downloadToWorkspace(
  fileId: string,
  account: string,
  options: DownloadOptions = {},
): Promise<WorkspaceDownload> {
  const raw = await call('drive', 'files.get', {
    fileId,
    fields: 'name,mimeType',
    supportsAllDrives: true,
  }, { account }) as Record<string, unknown>;
  const meta: DriveFileMeta = {
    name: String(raw.name || `file-${fileId}`),
    mimeType: String(raw.mimeType || ''),
  };

  if (meta.mimeType.startsWith(GOOGLE_NATIVE_PREFIX)) {
    throw new Error(
      `"${meta.name}" is a Google-native file (${meta.mimeType}) and has no bytes to download. ` +
      `Use manage_drive export to convert it into the workspace first.`,
    );
  }
  options.accept?.(meta);

  const wsStatus = await ensureWorkspaceDir();
  if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);

  // A caller-chosen outputPath may name subdirectories; a Drive name is one segment,
  // whatever slashes it happens to contain.
  const outputPath = resolveWorkspacePath(options.outputPath || sanitizeFilename(meta.name));
  await verifyPathSafety(outputPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Stream the bytes straight to disk — they are never a JS string (ADR-103).
  // `alt: 'media'` is what turns files.get from a metadata read into a byte stream.
  await download('drive', 'files.get', {
    fileId,
    alt: 'media',
    supportsAllDrives: true,
  }, outputPath, { account });

  return {
    ...meta,
    filename: path.relative(getWorkspaceDir(), outputPath),
    path: outputPath,
  };
}
