/**
 * Send adapter: workspace — writes scratchpad content to a file in the workspace directory.
 * Attachments are copied alongside the content file.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveWorkspacePath, verifyPathSafety } from '../../../executor/workspace.js';
import { ensureWorkspaceDir } from '../../../executor/workspace.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface WorkspaceTargetParams {
  filename: string;
}

export async function sendWorkspace(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  targetParams: WorkspaceTargetParams,
): Promise<HandlerResponse> {
  const content = scratchpads.getContent(scratchpadId);
  if (content === null) {
    return { text: `Scratchpad ${scratchpadId} not found.`, refs: { error: true } };
  }

  const { filename } = targetParams;
  if (!filename) {
    return {
      text: `Send failed: filename is required for workspace target.\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  const wsStatus = await ensureWorkspaceDir();
  if (!wsStatus.valid) {
    return {
      text: `Send failed: workspace invalid — ${wsStatus.warning}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  try {
    const filePath = resolveWorkspacePath(filename);
    await verifyPathSafety(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');

    const size = Buffer.byteLength(content);

    // TODO: Copy attachments alongside the file
    const attachments = scratchpads.getAttachments(scratchpadId);
    const attCount = attachments?.size ?? 0;
    const attNote = attCount > 0 ? `\n${attCount} attachment(s) — copy not yet implemented.` : '';

    return {
      text: `Written to workspace: **${filename}** (${size} bytes)${attNote}\n\n**Path:** ${filePath}`,
      refs: { scratchpadId, filename, path: filePath, size },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}
