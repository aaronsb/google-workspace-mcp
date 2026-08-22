/**
 * Drive patch — domain-specific hooks for the drive service.
 *
 * Key customizations:
 * - Custom formatters for file lists and details
 * - Upload: custom handler with positional file path arg
 * - Download/Export: stream to the workspace, return inline for text
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import { call, download, upload } from '../../google/client.js';
import { lookupMimeType } from '../gmail/mime.js';
import { formatFileList, formatFileDetail } from '../../server/formatting/markdown.js';
import { requireString } from '../../server/handlers/validate.js';
import { ensureWorkspaceDir, resolveWorkspacePath, verifyPathSafety } from '../../executor/workspace.js';
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

/** Drive's MIME type for a folder. */
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Escape a value for interpolation into a Drive `q` query.
 *
 * Drive's query grammar quotes string literals with single quotes, so an id or
 * name containing one would close the literal early. Backslash first, then the
 * quote, or the escapes we add would themselves be escaped.
 */
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** How many pages of children to walk before giving up and saying so. */
const MAX_CHILD_PAGES = 20;

/** How deep `tree` recurses before stopping and labelling the result partial. */
const DEFAULT_TREE_DEPTH = 10;

/**
 * Non-trashed children of a folder, ordered by name.
 *
 * This is the `ls` primitive from gdrive-tools: files.list filtered to one
 * parent. Used by `listFolder` (one level) and `tree` (recursive).
 *
 * Pages to exhaustion rather than taking the first page: callers render a count
 * ("TOTAL FILES", "Contents of X (n)"), and a silently truncated list makes that
 * count wrong while still looking authoritative. `truncated` says when the page
 * cap stopped the walk early, so the caller can label the number honestly.
 */
async function listChildren(
  folderId: string,
  account: string,
  pageSize = 1000,
): Promise<{ files: Array<Record<string, unknown>>; truncated: boolean }> {
  const files: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const data = await call('drive', 'files.list', {
      q: `'${escapeQueryValue(folderId)}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize,
      orderBy: 'name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(pageToken ? { pageToken } : {}),
    }, { account }) as Record<string, unknown>;

    files.push(...((data.files || []) as Array<Record<string, unknown>>));
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined;
    pages += 1;
  } while (pageToken && pages < MAX_CHILD_PAGES);

  return { files, truncated: Boolean(pageToken) };
}

export const drivePatch: ServicePatch = {
  formatList: (data: unknown) => formatFileList(data),
  formatDetail: (data: unknown) => formatFileDetail(data),

  customHandlers: {
    /**
     * Upload. Uses the RESUMABLE endpoint, never `uploadType=multipart`, which has
     * no chunking and falls over on a large file. ADR-103 item 4 verified resumable
     * carries a 25 MB payload and round-trips it byte-for-byte, with the same result
     * for a small file.
     */
    upload: async (params, account): Promise<HandlerResponse> => {
      // A RELATIVE path is workspace-relative — the same convention `download`,
      // `export` and email attachments already use. It used to resolve against the
      // server's cwd (which is wherever the MCP client happened to launch it, often
      // `/`), so a file just written by manage_workspace or a scratchpad `send` could
      // not be uploaded by the name it was given: `ENOENT: smoke/report.md`. The two
      // halves of the same tool disagreed about what a path meant.
      //
      // Absolute paths are untouched, so anything uploading from outside the workspace
      // keeps working.
      const given = requireString(params, 'filePath');
      const filePath = isAbsolute(given) ? given : resolveWorkspacePath(given);
      await verifyPathSafety(filePath);
      const media = await readFile(filePath);

      const metadata: Record<string, unknown> = {
        name: params.name ? String(params.name) : basename(filePath),
      };
      if (params.parentFolderId) metadata.parents = [String(params.parentFolderId)];

      const data = await upload('drive', 'files.create', {}, {
        account,
        media,
        contentType: lookupMimeType(filePath),
        metadata,
      }) as Record<string, unknown>;

      return {
        text: `File uploaded: **${data.name ?? filePath}**\n\n**File ID:** ${data.id ?? 'unknown'}`,
        refs: { id: data.id, fileId: data.id, name: data.name },
      };
    },

    copy: async (params, account): Promise<HandlerResponse> => {
      // files.copy takes the new file's metadata (name, parents) as the
      // request body, not query --params. The generator's generic path
      // collapses everything into --params, so a passed `name` was silently
      // dropped and copies kept Drive's "Copy of <original>" default name.
      const fileId = requireString(params, 'fileId');

      const body: Record<string, unknown> = {};
      if (params.name) body.name = String(params.name);
      if (params.parentFolderId) body.parents = [String(params.parentFolderId)];

      const data = await call('drive', 'files.copy', {
        fileId,
        fields: 'id, name, mimeType, parents, webViewLink',
        supportsAllDrives: true,
        ...body,
      }, { account }) as Record<string, unknown>;
      return {
        text: `File copied: **${data.name ?? 'copy'}**\n\n**File ID:** ${data.id ?? 'unknown'}` +
          (data.webViewLink ? `\n**Link:** ${data.webViewLink}` : ''),
        refs: { fileId: data.id, id: data.id, name: data.name, sourceFileId: fileId },
      };
    },

    update: async (params, account): Promise<HandlerResponse> => {
      // Rename a file (body: name) and/or move it between folders (query:
      // addParents/removeParents). files.update needs renamable metadata in
      // the request body and parent changes in query params — the generic
      // path can't split one request across both.
      const fileId = requireString(params, 'fileId');

      const body: Record<string, unknown> = {};
      if (params.name) body.name = String(params.name);

      const queryParams: Record<string, unknown> = {
        fileId,
        fields: 'id, name, mimeType, parents, webViewLink',
        supportsAllDrives: true,
      };
      if (params.addParents) queryParams.addParents = String(params.addParents);
      if (params.removeParents) queryParams.removeParents = String(params.removeParents);

      if (Object.keys(body).length === 0 && !queryParams.addParents && !queryParams.removeParents) {
        throw new Error('update requires at least one of: name, addParents, removeParents');
      }

      const data = await call('drive', 'files.update', {
        ...queryParams,
        ...body,
      }, { account }) as Record<string, unknown>;
      const parents = Array.isArray(data.parents) ? (data.parents as string[]) : undefined;
      return {
        text: `File updated: **${data.name ?? fileId}**\n\n**File ID:** ${data.id ?? fileId}` +
          (parents ? `\n**Parents:** ${parents.join(', ')}` : ''),
        refs: {
          fileId: data.id ?? fileId,
          id: data.id ?? fileId,
          name: data.name,
          ...(parents ? { parents } : {}),
        },
      };
    },

    createFolder: async (params, account): Promise<HandlerResponse> => {
      // files.create makes a folder when mimeType is the folder MIME, and takes
      // `parents` as an ARRAY of ids in the request body. The generic path collapses
      // every param into the body as a scalar, so a single parentFolderId would land
      // as `parents: "id"` (a string) and Drive rejects it. Build the body here.
      const name = requireString(params, 'name');

      const body: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
      if (params.parentFolderId) body.parents = [String(params.parentFolderId)];

      const data = await call('drive', 'files.create', {
        fields: 'id, name, mimeType, parents, webViewLink',
        supportsAllDrives: true,
        ...body,
      }, { account }) as Record<string, unknown>;

      return {
        text: `Folder created: **${data.name ?? name}**\n\n**Folder ID:** ${data.id ?? 'unknown'}` +
          (data.webViewLink ? `\n**Link:** ${data.webViewLink}` : ''),
        refs: { folderId: data.id, fileId: data.id, id: data.id, name: data.name ?? name },
      };
    },

    listFolder: async (params, account): Promise<HandlerResponse> => {
      const folderId = requireString(params, 'folderId');
      const { files: children, truncated } = await listChildren(folderId, account);

      if (children.length === 0) {
        return {
          text: `Folder ${folderId} is empty (or contains only trashed items).`,
          refs: { folderId, fileId: folderId, count: 0, files: [] },
        };
      }

      const rows = children.map((f) => ({
        fileId: String(f.id ?? ''),
        name: String(f.name ?? ''),
        mimeType: String(f.mimeType ?? ''),
        isFolder: f.mimeType === FOLDER_MIME,
      }));
      const lines = children.map((f) =>
        `${f.mimeType === FOLDER_MIME ? '[DIR] ' : ''}${String(f.name ?? '')}  (${String(f.id ?? '')})`);

      return {
        text: `## Contents of ${folderId} (${truncated ? `${children.length}+, listing capped` : children.length})\n\n${lines.join('\n')}`,
        refs: { folderId, fileId: folderId, count: children.length, truncated, files: rows },
      };
    },

    tree: async (params, account): Promise<HandlerResponse> => {
      const folderId = requireString(params, 'folderId');
      const maxDepth = typeof params.maxDepth === 'number' ? params.maxDepth : DEFAULT_TREE_DEPTH;
      const lines: string[] = [];
      let fileCount = 0;
      let capped = false;

      // One serial API call per directory, so an unbounded walk on a deep tree is
      // slow and can exhaust the rate limit. `seen` guards the other direction: a
      // Drive file may have several parents, so the folder graph can revisit a
      // node and — via shortcuts — cycle.
      const seen = new Set<string>();
      const walk = async (id: string, depth: number): Promise<void> => {
        if (depth >= maxDepth) { capped = true; return; }
        if (seen.has(id)) return;
        seen.add(id);

        const { files: children, truncated } = await listChildren(id, account);
        if (truncated) capped = true;
        for (const child of children) {
          const isDir = child.mimeType === FOLDER_MIME;
          lines.push('   '.repeat(depth) + (isDir ? '[DIR] ' : '      ') + String(child.name ?? ''));
          if (isDir) await walk(String(child.id), depth + 1);
          else fileCount += 1;
        }
      };

      await walk(folderId, 0);

      return {
        text: `## Folder tree\n\n${lines.join('\n')}\n\n**TOTAL FILES:** ${capped ? `${fileCount}+ (partial — depth limit ${maxDepth} or page cap reached)` : fileCount}`,
        refs: { folderId, fileId: folderId, fileCount, partial: capped },
      };
    },

    trash: async (params, account): Promise<HandlerResponse> => {
      // files.update with trashed:true in the BODY moves a file to trash — recoverable
      // for 30 days. This is the safe alternative to `delete`, which is permanent.
      const fileId = requireString(params, 'fileId');

      const data = await call('drive', 'files.update', {
        fileId,
        fields: 'id, name, trashed',
        supportsAllDrives: true,
        trashed: true,
      }, { account }) as Record<string, unknown>;

      return {
        text: `Moved to trash: **${data.name ?? fileId}**\n\n**File ID:** ${data.id ?? fileId}\n` +
          `Recoverable for 30 days from Drive's Trash.`,
        refs: { fileId: data.id ?? fileId, id: data.id ?? fileId, name: data.name, trashed: true },
      };
    },

    download: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');

      // Get file metadata for filename and mime type
      const meta = await call('drive', 'files.get', {
        fileId,
        fields: 'name,mimeType',
        supportsAllDrives: true,
      }, { account }) as Record<string, unknown>;
      const filename = String(params.outputPath || meta.name || `file-${fileId}`);
      const mimeType = String(meta.mimeType || '');

      // Ensure workspace and resolve output path
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      const outputPath = resolveWorkspacePath(filename);
      await verifyPathSafety(outputPath);

      // Ensure parent directories exist (outputPath may contain subdirectories)
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Stream the bytes straight to disk — they are never a JS string (ADR-103).
      await download('drive', 'files.get', {
        fileId,
        alt: 'media',
        supportsAllDrives: true,
      }, outputPath, { account });

      const output = await readWorkspaceFile(outputPath, filename, mimeType);

      return {
        text: formatFileOutput(output),
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
      const meta = await call('drive', 'files.get', {
        fileId,
        fields: 'name,mimeType,size',
        supportsAllDrives: true,
      }, { account }) as Record<string, unknown>;
      const filename = String(meta.name || `image-${fileId}`);
      const mimeType = String(meta.mimeType || '');

      if (!isImageFile(filename, mimeType)) {
        throw new Error(`File "${filename}" (${mimeType}) is not a viewable image type`);
      }

      // Download to temp file, read into memory, clean up
      const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const tmpPath = path.join(os.tmpdir(), `gws-view-${safeId}-${Date.now()}`);
      try {
        await download('drive', 'files.get', {
          fileId,
          alt: 'media',
          supportsAllDrives: true,
        }, tmpPath, { account });

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
      const meta = await call('drive', 'files.get', {
        fileId,
        fields: 'name',
        supportsAllDrives: true,
      }, { account }) as Record<string, unknown>;
      const baseName = String(meta.name || `export-${fileId}`).replace(/\.[^.]+$/, '');
      const filename = String(params.outputPath || `${baseName}${ext}`);

      // Ensure workspace and resolve output path
      const wsStatus = await ensureWorkspaceDir();
      if (!wsStatus.valid) throw new Error(`Workspace invalid: ${wsStatus.warning}`);
      const outputPath = resolveWorkspacePath(filename);
      await verifyPathSafety(outputPath);

      // Ensure parent directories exist (outputPath may contain subdirectories)
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Stream the exported bytes straight to disk (ADR-103).
      await download('drive', 'files.export', { fileId, mimeType }, outputPath, { account });

      const output = await readWorkspaceFile(outputPath, filename, mimeType);

      return {
        text: formatFileOutput(output),
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

      const data = await call('drive', 'comments.list', {
        fileId,
        includeDeleted,
        fields: 'comments(id, content, htmlContent, author(displayName, emailAddress), createdTime, modifiedTime, resolved, quotedFileContent, replies(id, content, author(displayName), createdTime)), nextPageToken',
      }, { account }) as Record<string, unknown>;
      const comments = (data.comments || []) as Array<Record<string, unknown>>;

      if (comments.length === 0) {
        return {
          text: 'No comments on this file.',
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
        text: `## Comments (${comments.length})\n\n${lines.join('\n\n')}`,
        refs: { fileId, count: comments.length },
      };
    },

    getComment: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const commentId = requireString(params, 'commentId');

      const c = await call('drive', 'comments.get', {
        fileId,
        commentId,
        fields: 'id, content, htmlContent, author(displayName, emailAddress), createdTime, modifiedTime, resolved, quotedFileContent, replies(id, content, htmlContent, author(displayName), createdTime)',
      }, { account }) as Record<string, unknown>;
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
          (replyLines ? `\n\n### Replies\n\n${replyLines}` : ''),
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

      const data = await call('drive', 'comments.create', {
        fileId,
        fields: 'id, content, htmlContent, author(displayName), createdTime, quotedFileContent',
        ...body,
      }, { account }) as Record<string, unknown>;
      return {
        text: `Comment added.\n\n**ID:** ${data.id}\n**Content:** ${data.content}` +
          (quotedText ? `\n**Anchored to:** "${quotedText}"` : ''),
        refs: { commentId: data.id, fileId },
      };
    },

    resolveComment: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const commentId = requireString(params, 'commentId');
      const resolved = params.resolved !== false;

      // Fetch existing comment to preserve content when updating
      const existingData = await call('drive', 'comments.get', {
        fileId,
        commentId,
        fields: 'content',
      }, { account }) as Record<string, unknown>;

      const data = await call('drive', 'comments.update', {
        fileId,
        commentId,
        fields: 'id, content, resolved',
        content: existingData.content || '',
        resolved,
      }, { account }) as Record<string, unknown>;
      return {
        text: `Comment ${resolved ? 'resolved' : 'reopened'}.\n\n**ID:** ${data.id}\n**Resolved:** ${resolved}`,
        refs: { commentId: data.id, fileId, resolved },
      };
    },

    listPermissions: async (params, account): Promise<HandlerResponse> => {
      // permissions.list returns `{ permissions: [...] }`, not `{ files: [...] }`,
      // so the generic drive list formatter (formatFileList) reported "No files
      // found" for every call. This handler fetches the permission fields the
      // default response omits (role, emailAddress, domain) and renders them.
      const fileId = requireString(params, 'fileId');

      const data = await call('drive', 'permissions.list', {
        fileId,
        fields: 'permissions(id, type, role, emailAddress, domain, displayName, deleted, pendingOwner)',
        supportsAllDrives: true,
      }, { account }) as Record<string, unknown>;
      const permissions = (data.permissions || []) as Array<Record<string, unknown>>;

      if (permissions.length === 0) {
        return {
          text: `No sharing permissions on file ${fileId}.`,
          refs: { fileId, count: 0, permissions: [] },
        };
      }

      const targetOf = (p: Record<string, unknown>): string =>
        p.emailAddress ? String(p.emailAddress)
          : p.domain ? String(p.domain)
            : String(p.type) === 'anyone' ? 'anyone with the link'
              : p.displayName ? String(p.displayName)
                : '';

      const rows = permissions.map((p) => ({
        permissionId: String(p.id ?? ''),
        type: String(p.type ?? ''),
        role: String(p.role ?? ''),
        target: targetOf(p),
      }));

      const lines = permissions.map((p, i) => {
        const { permissionId, type, role, target } = rows[i];
        const flags = `${p.pendingOwner ? ' [pending owner]' : ''}${p.deleted ? ' [deleted account]' : ''}`;
        return `${permissionId} | ${role} | ${type}${target ? ' | ' + target : ''}${flags}`;
      });

      return {
        text: `## Permissions on ${fileId} (${permissions.length})\n\n${lines.join('\n')}`,
        // No singular permissionId here — a list has no canonical "the" permission;
        // unshare callers must pick a specific row's permissionId from `permissions`.
        refs: {
          fileId,
          count: permissions.length,
          permissions: rows,
        },
      };
    },

    share: async (params, account): Promise<HandlerResponse> => {
      // Drive v3 permissions.create requires the permission body (type, role,
      // emailAddress|domain) to be POSTed as the request body, not passed
      // through query --params. The generator's default buildResourceArgs
      // collapses everything into --params, which makes the API reject the
      // call with "The permission type field is required." This handler sends
      // the body via --json.
      const fileId = requireString(params, 'fileId');
      const role = (params.role as string) || 'reader';
      const type = (params.type as string) || 'user';

      const body: Record<string, unknown> = { role, type };

      if (type === 'user' || type === 'group') {
        const email = (params.shareEmail as string) || '';
        if (!email) {
          throw new Error(`share requires shareEmail when type is '${type}'`);
        }
        body.emailAddress = email;
      } else if (type === 'domain') {
        const domain = (params.domain as string) || '';
        if (!domain) {
          throw new Error("share requires the 'domain' param when type is 'domain'");
        }
        body.domain = domain;
      }
      // type === 'anyone' needs no additional fields.

      const queryParams: Record<string, unknown> = {
        fileId,
        supportsAllDrives: true,
      };
      // Skip the noisy "notify by email" default — the caller didn't ask for it.
      if (type === 'user' || type === 'group') {
        queryParams.sendNotificationEmail = false;
      }

      const data = await call('drive', 'permissions.create', {
        ...queryParams,
        ...body,
      }, { account }) as Record<string, unknown>;

      const target =
        type === 'user' || type === 'group'
          ? (body.emailAddress as string)
          : type === 'domain'
            ? (body.domain as string)
            : 'anyone with the link';

      return {
        text: `File shared with **${target}** as ${role} (${type}).\n\n` +
          `**File ID:** ${fileId}\n` +
          `**Permission ID:** ${data.id ?? 'unknown'}`,
        refs: { fileId, permissionId: data.id, role, type, target },
      };
    },

    setRole: async (params, account): Promise<HandlerResponse> => {
      // permissions.update changes an existing permission's role WITHOUT sending any
      // notification email — the "upgrade quietly" path gdrive-tools calls set_role.
      // The permission must already exist, so resolve the email to its permission id
      // first (the API addresses permissions by id, not email).
      const fileId = requireString(params, 'fileId');
      const email = requireString(params, 'shareEmail');

      // No default here. `share` may safely default to `reader` — granting the
      // least privilege is the conservative choice when adding a collaborator.
      // Changing an EXISTING role has no conservative default: falling back to
      // `reader` silently demotes whoever is being edited, and this operation
      // sends no notification, so nobody would learn of it.
      const role = requireString(params, 'role');

      const listData = await call('drive', 'permissions.list', {
        fileId,
        fields: 'permissions(id, type, role, emailAddress)',
        supportsAllDrives: true,
      }, { account }) as Record<string, unknown>;
      const permissions = (listData.permissions || []) as Array<Record<string, unknown>>;
      const match = permissions.find((p) =>
        (String(p.emailAddress ?? '')).toLowerCase() === email.toLowerCase());

      if (!match) {
        throw new Error(`${email} has no existing permission on ${fileId} — use 'share' to grant access first.`);
      }

      const data = await call('drive', 'permissions.update', {
        fileId,
        permissionId: String(match.id),
        fields: 'id, role, emailAddress',
        supportsAllDrives: true,
        role,
      }, { account }) as Record<string, unknown>;

      return {
        text: `Updated ${email} to **${data.role ?? role}** on ${fileId}. No notification email was sent.`,
        refs: {
          fileId,
          permissionId: data.id ?? match.id,
          role: data.role ?? role,
          target: email,
          notificationEmailSent: false,
        },
      };
    },

    replyToComment: async (params, account): Promise<HandlerResponse> => {
      const fileId = requireString(params, 'fileId');
      const commentId = requireString(params, 'commentId');
      const content = requireString(params, 'content');

      const data = await call('drive', 'replies.create', {
        fileId,
        commentId,
        fields: 'id, content, htmlContent, author(displayName), createdTime',
        content,
      }, { account }) as Record<string, unknown>;
      return {
        text: `Reply added.\n\n**ID:** ${data.id}\n**Content:** ${data.content}`,
        refs: { replyId: data.id, commentId, fileId },
      };
    },
  },
};
