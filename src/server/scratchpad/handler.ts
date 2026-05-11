/**
 * Handler for manage_scratchpad tool.
 * See ADR-301: Scratchpad Buffer — Service-Agnostic Content Authoring.
 */

import { ScratchpadManager, type LiveBinding } from './manager.js';
import { translateMutation, isRejection, type DocsSyncIntent } from './docs-sync.js';
import * as fs from 'node:fs/promises';
import {
  sendEmail, sendEmailDraft, sendDocCreate, sendDocWrite, sendWorkspace,
  sendSheetWrite, sendCalendarEvent, sendTaskCreate,
  importEmail, importDoc, importSheet, importDriveFile, importMeet,
} from './adapters/index.js';
import { execute } from '../../executor/gws.js';
import { resolveWorkspacePath, verifyPathSafety } from '../../executor/workspace.js';
import { lookupMimeType } from '../../services/gmail/mime.js';
import type { HandlerResponse } from '../handler.js';

const scratchpads = new ScratchpadManager();

/** Expose the singleton for import/send adapters. */
export function getScratchpadManager(): ScratchpadManager {
  return scratchpads;
}

export async function handleScratchpad(params: Record<string, unknown>): Promise<HandlerResponse> {
  const operation = params.operation as string;

  switch (operation) {
    // ── Buffer lifecycle ────────────────────────────────
    case 'create':
      return handleCreate(params);
    case 'view':
      return handleView(params);
    case 'discard':
      return handleDiscard(params);
    case 'list':
      return handleList();

    // ── Line operations ─────────────────────────────────
    case 'insert_lines':
      return handleInsertLines(params);
    case 'append_lines':
      return handleAppendLines(params);
    case 'replace_lines':
      return handleReplaceLines(params);
    case 'remove_lines':
      return handleRemoveLines(params);
    case 'copy_lines':
      return handleCopyLines(params);

    // ── JSON path operations ────────────────────────────
    case 'json_get':
      return handleJsonGet(params);
    case 'json_set':
      return handleJsonSet(params);
    case 'json_delete':
      return handleJsonDelete(params);
    case 'json_insert':
      return handleJsonInsert(params);

    // ── Attachments ─────────────────────────────────────
    case 'attach':
      return handleAttach(params);
    case 'detach':
      return handleDetach(params);

    // ── Import / Send ───────────────────────────────────
    case 'import':
      return handleImport(params);
    case 'send':
      return handleSend(params);

    default:
      return error(`Unknown operation: ${operation}`);
  }
}

// ── Helpers ────────────────────────────────────────────────

function error(text: string): HandlerResponse {
  return { text, refs: { error: true } };
}

function requireScratchpadId(params: Record<string, unknown>): string | null {
  const id = params.scratchpadId as string | undefined;
  if (!id) return null;
  if (!scratchpads.get(id)) return null;
  return id;
}

function scratchpadNotFound(id?: string): HandlerResponse {
  if (!id) return error('scratchpadId is required. Use create to start a new scratchpad.');
  return error(`Scratchpad ${id} not found or expired. Use create to start a new one.`);
}

function formatMutation(result: { message: string; context: string; validation: string }): string {
  const parts = [result.message];
  if (result.context) parts.push(result.context);
  parts.push(result.validation);
  return parts.join('\n');
}

// ── Buffer lifecycle ──────────────────────────────────────

function handleCreate(params: Record<string, unknown>): HandlerResponse {
  const id = scratchpads.create({
    label: params.label as string | undefined,
    content: params.content as string | undefined,
    format: params.format as 'text' | 'markdown' | 'json' | 'csv' | undefined,
  });

  const sp = scratchpads.get(id)!;
  const lineInfo = sp.lines.length > 0 ? ` (${sp.lines.length} lines)` : '';
  return {
    text: `Scratchpad created: ${id}${lineInfo}\nFormat: ${sp.format}`,
    refs: { scratchpadId: id, format: sp.format, lineCount: sp.lines.length },
  };
}

function handleView(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const result = scratchpads.view(id, params.startLine as number, params.endLine as number);
  if (!result) return scratchpadNotFound(id);
  return { text: result, refs: { scratchpadId: id } };
}

function handleDiscard(params: Record<string, unknown>): HandlerResponse {
  const id = params.scratchpadId as string;
  if (!id) return error('scratchpadId is required.');
  scratchpads.discard(id);
  return { text: `Scratchpad ${id} discarded.`, refs: { scratchpadId: id, status: 'discarded' } };
}

function handleList(): HandlerResponse {
  const list = scratchpads.list();
  if (list.length === 0) {
    return { text: 'No active scratchpads.', refs: { count: 0 } };
  }

  const lines = list.map(sp => {
    const label = sp.label ? ` "${sp.label}"` : '';
    const att = sp.attachmentCount > 0 ? ` | ${sp.attachmentCount} att` : '';
    const bound = sp.bound ? ' | live' : '';
    return `- ${sp.id}${label} | ${sp.format} | ${sp.lineCount} lines${att}${bound} | ${sp.validation}`;
  });

  return {
    text: `Active scratchpads (${list.length}):\n${lines.join('\n')}`,
    refs: { count: list.length, scratchpads: list.map(s => s.id) },
  };
}

// ── Line operations ───────────────────────────────────────

function handleInsertLines(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const afterLine = params.afterLine as number | undefined;
  if (afterLine === undefined) return error('afterLine is required for insert_lines.');
  const content = params.content as string | undefined;
  if (content === undefined) return error('content is required for insert_lines.');

  const result = scratchpads.insertLines(id, afterLine, content);
  if (!result) return scratchpadNotFound(id);
  return { text: formatMutation(result), refs: { scratchpadId: id, lineCount: scratchpads.get(id)!.lines.length } };
}

function handleAppendLines(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const content = params.content as string | undefined;
  if (content === undefined) return error('content is required for append_lines.');

  const result = scratchpads.appendLines(id, content);
  if (!result) return scratchpadNotFound(id);
  return { text: formatMutation(result), refs: { scratchpadId: id, lineCount: scratchpads.get(id)!.lines.length } };
}

function handleReplaceLines(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const startLine = params.startLine as number | undefined;
  const endLine = params.endLine as number | undefined;
  if (startLine === undefined || endLine === undefined) return error('startLine and endLine are required.');
  const content = params.content as string | undefined;
  if (content === undefined) return error('content is required for replace_lines.');

  const result = scratchpads.replaceLines(id, startLine, endLine, content);
  if (!result) return scratchpadNotFound(id);
  return { text: formatMutation(result), refs: { scratchpadId: id, lineCount: scratchpads.get(id)!.lines.length } };
}

function handleRemoveLines(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const startLine = params.startLine as number | undefined;
  if (startLine === undefined) return error('startLine is required for remove_lines.');

  const result = scratchpads.removeLines(id, startLine, params.endLine as number | undefined);
  if (!result) return scratchpadNotFound(id);
  return { text: formatMutation(result), refs: { scratchpadId: id, lineCount: scratchpads.get(id)!.lines.length } };
}

function handleCopyLines(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const fromId = params.fromScratchpadId as string | undefined;
  if (!fromId) return error('fromScratchpadId is required for copy_lines.');
  const startLine = params.startLine as number | undefined;
  const endLine = params.endLine as number | undefined;
  const afterLine = params.afterLine as number | undefined;
  if (startLine === undefined || endLine === undefined || afterLine === undefined) {
    return error('startLine, endLine, and afterLine are required for copy_lines.');
  }

  const result = scratchpads.copyLines(id, fromId, startLine, endLine, afterLine);
  if (!result) return scratchpadNotFound(id);
  return { text: formatMutation(result), refs: { scratchpadId: id, lineCount: scratchpads.get(id)!.lines.length } };
}

// ── JSON path operations ──────────────────────────────────

function handleJsonGet(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const path = params.path as string | undefined;
  if (!path) return error('path is required for json_get.');

  const result = scratchpads.jsonGet(id, path);
  if (!result) return scratchpadNotFound(id);
  if ('error' in result) return error(result.error);

  const display = JSON.stringify(result.value, null, 2);
  return {
    text: `${path} (${result.lineSpan}):\n${display}`,
    refs: { scratchpadId: id, path, value: result.value },
  };
}

async function handleJsonSet(params: Record<string, unknown>): Promise<HandlerResponse> {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const jsonPath = params.path as string | undefined;
  if (!jsonPath) return error('path is required for json_set.');
  if (!('value' in params)) return error('value is required for json_set.');

  // For docs-bound scratchpads, pre-validate the mutation before applying
  // locally — unsupported paths shouldn't strand the buffer divergent.
  const docsResult = await maybeHandleDocsBoundMutation(id, {
    op: 'set', path: jsonPath, value: params.value,
  });
  if (docsResult) return docsResult;

  // Non-docs flow: mutate, then sync (sheets pushes; unbound is a no-op).
  const result = scratchpads.jsonSet(id, jsonPath, params.value);
  if (!result) return scratchpadNotFound(id);
  const syncResult = await syncIfBound(id);
  if (syncResult) return syncResult;
  return { text: formatMutation(result), refs: { scratchpadId: id } };
}

async function handleJsonDelete(params: Record<string, unknown>): Promise<HandlerResponse> {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const jsonPath = params.path as string | undefined;
  if (!jsonPath) return error('path is required for json_delete.');

  const docsResult = await maybeHandleDocsBoundMutation(id, { op: 'delete', path: jsonPath });
  if (docsResult) return docsResult;

  const result = scratchpads.jsonDelete(id, jsonPath);
  if (!result) return scratchpadNotFound(id);
  const syncResult = await syncIfBound(id);
  if (syncResult) return syncResult;
  return { text: formatMutation(result), refs: { scratchpadId: id } };
}

async function handleJsonInsert(params: Record<string, unknown>): Promise<HandlerResponse> {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const jsonPath = params.path as string | undefined;
  if (!jsonPath) return error('path is required for json_insert.');
  if (!('value' in params)) return error('value is required for json_insert.');

  const docsResult = await maybeHandleDocsBoundMutation(id, {
    op: 'insert', path: jsonPath, value: params.value,
  });
  if (docsResult) return docsResult;

  const result = scratchpads.jsonInsert(id, jsonPath, params.value);
  if (!result) return scratchpadNotFound(id);
  const syncResult = await syncIfBound(id);
  if (syncResult) return syncResult;
  return { text: formatMutation(result), refs: { scratchpadId: id } };
}

/**
 * For docs-bound scratchpads, translate the intent, push via batchUpdate,
 * reload, and return the response. Returns null when the scratchpad isn't
 * docs-bound (caller falls through to the existing non-docs flow).
 *
 * The mutation is pre-validated against the BEFORE buffer so unsupported
 * paths reject without mutating local state (#79).
 */
async function maybeHandleDocsBoundMutation(
  id: string,
  intent: Omit<DocsSyncIntent, 'beforeJson'>,
): Promise<HandlerResponse | null> {
  const binding = scratchpads.getBinding(id);
  if (binding?.service !== 'docs') return null;

  const before = scratchpads.getContent(id);
  if (before === null) return scratchpadNotFound(id);

  const translated = translateMutation({ ...intent, beforeJson: before }, binding.revisionId);
  if (isRejection(translated)) {
    return error(`json_${intent.op} rejected: ${translated.reason}`);
  }

  // Apply the mutation locally now that we know it's translatable.
  const result = applyMutation(id, intent);
  if (!result) return scratchpadNotFound(id);

  // Push to the Docs API.
  try {
    await execute([
      'docs', 'documents', 'batchUpdate',
      '--params', JSON.stringify({ documentId: binding.resourceId }),
      '--json', JSON.stringify(translated.body),
    ], { account: binding.account });
  } catch (err) {
    // The buffer has the local change; the doc doesn't. Match the sheets
    // error contract — agent retries or discards.
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Sync failed: ${message}\nLocal buffer still has your changes. Retry or use scratchpad reset to discard.`,
      refs: { error: true, scratchpadId: id },
    };
  }

  // Reload the buffer from the doc — the doc is the source of truth.
  // This also picks up the new revisionId for the next sync.
  await reloadDocsBuffer(id, binding);

  return {
    text: `${formatMutation(result)}\n_Synced: ${translated.summary}_`,
    refs: { scratchpadId: id, synced: true, summary: translated.summary },
  };
}

/** Dispatch the local mutation matching the intent's op. */
function applyMutation(
  id: string,
  intent: Omit<DocsSyncIntent, 'beforeJson'>,
): ReturnType<ScratchpadManager['jsonSet']> {
  switch (intent.op) {
    case 'set':    return scratchpads.jsonSet(id, intent.path, intent.value);
    case 'delete': return scratchpads.jsonDelete(id, intent.path);
    case 'insert': return scratchpads.jsonInsert(id, intent.path, intent.value);
  }
}

/** Re-fetch the doc, replace the buffer, and update the binding's revisionId. */
async function reloadDocsBuffer(id: string, binding: LiveBinding): Promise<void> {
  const result = await execute([
    'docs', 'documents', 'get',
    '--params', JSON.stringify({ documentId: binding.resourceId }),
  ], { account: binding.account });
  const doc = result.data as Record<string, unknown>;
  const freshJson = JSON.stringify(doc, null, 2);
  const sp = scratchpads.get(id);
  if (!sp) return;
  sp.lines = freshJson.split('\n');
  if (sp.binding) {
    sp.binding.revisionId = typeof doc.revisionId === 'string' ? doc.revisionId : undefined;
  }
}

/**
 * If the scratchpad is live-bound, push the current buffer to the API
 * and reload from the live resource. Returns an error HandlerResponse
 * on failure, or null on success (caller uses its own mutation result).
 */
async function syncIfBound(id: string): Promise<HandlerResponse | null> {
  const binding = scratchpads.getBinding(id);
  if (!binding) return null;

  const content = scratchpads.getContent(id);
  if (content === null) return null;

  try {
    if (binding.service === 'docs') {
      // Docs JSON-mode mutations are handled upstream by
      // maybeHandleDocsBoundMutation, which translates the intent into
      // a batchUpdate request, pushes, and reloads. Reaching this point
      // means a non-json operation on a docs-bound scratchpad — nothing
      // to sync (those op types don't reflect into the doc anyway).
      return null;
    } else if (binding.service === 'sheets') {
      // For Sheets: the buffer is the values JSON.
      // Push back via spreadsheets.values.update.
      const data = JSON.parse(content) as Record<string, unknown>;
      const values = data.values as unknown[][] | undefined;
      const range = data.range as string | undefined;

      if (values && range) {
        await execute([
          'sheets', 'spreadsheets', 'values', 'update',
          '--params', JSON.stringify({
            spreadsheetId: binding.resourceId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
          }),
        ], { account: binding.account });
      }

      // Reload from API
      const result = await execute([
        'sheets', 'spreadsheets', 'values', 'get',
        '--params', JSON.stringify({
          spreadsheetId: binding.resourceId,
          range: range ?? 'Sheet1',
        }),
      ], { account: binding.account });

      const freshJson = JSON.stringify(result.data, null, 2);
      const sp = scratchpads.get(id);
      if (sp) {
        sp.lines = freshJson.split('\n');
      }
    }

    return null; // Success — caller uses its own result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Sync failed: ${message}\nLocal buffer still has your changes. Retry or discard.`,
      refs: { error: true, scratchpadId: id },
    };
  }
}

// ── Attachments ───────────────────────────────────────────

async function handleAttach(params: Record<string, unknown>): Promise<HandlerResponse> {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const source = params.source as 'workspace' | 'drive' | undefined;
  if (!source) return error('source is required for attach (workspace or drive).');
  const filename = params.filename as string | undefined;
  const fileId = params.fileId as string | undefined;
  if (!filename && !fileId) return error('filename (for workspace) or fileId (for drive) is required.');

  let resolvedFilename: string;
  let mimeType: string;
  let size: number;
  let location: string;

  if (source === 'workspace') {
    if (!filename) return error('filename is required for workspace attachments.');
    try {
      const filePath = resolveWorkspacePath(filename);
      await verifyPathSafety(filePath);
      const stat = await fs.stat(filePath);
      resolvedFilename = filename;
      mimeType = lookupMimeType(filename);
      size = stat.size;
      location = filePath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error(`Cannot attach workspace file: ${msg}`);
    }
  } else {
    // Drive attachments — use fileId as identifier, metadata resolved later on send
    resolvedFilename = fileId ?? 'unknown';
    mimeType = 'application/octet-stream';
    size = 0;
    location = fileId ?? '';
  }

  const result = scratchpads.attach(id, {
    source,
    filename: resolvedFilename,
    mimeType,
    size,
    location,
  }, params.afterLine as number | undefined);

  if (!result) return scratchpadNotFound(id);
  return { text: result.message, refs: { scratchpadId: id, refId: result.refId } };
}

function handleDetach(params: Record<string, unknown>): HandlerResponse {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const refId = params.refId as string | undefined;
  if (!refId) return error('refId is required for detach.');

  const result = scratchpads.detach(id, refId);
  if (!result) return scratchpadNotFound(id);
  return { text: result, refs: { scratchpadId: id, refId } };
}

// ── Import / Send (stubs — adapters in separate files) ────

async function handleImport(params: Record<string, unknown>): Promise<HandlerResponse> {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const source = params.source as string | undefined;
  if (!source) return error('source is required for import (doc, email, sheet, drive_file).');

  const sourceParams = (params.sourceParams ?? {}) as Record<string, unknown>;

  switch (source) {
    case 'email':
      return importEmail(scratchpads, id, sourceParams as unknown as Parameters<typeof importEmail>[2]);
    case 'doc':
      return importDoc(scratchpads, id, sourceParams as unknown as Parameters<typeof importDoc>[2]);
    case 'sheet':
      return importSheet(scratchpads, id, sourceParams as unknown as Parameters<typeof importSheet>[2]);
    case 'drive_file':
      return importDriveFile(scratchpads, id, sourceParams as unknown as Parameters<typeof importDriveFile>[2]);
    case 'meet':
      return importMeet(scratchpads, id, sourceParams as unknown as Parameters<typeof importMeet>[2]);
    default:
      return error(`Unknown import source: ${source}. Valid sources: doc, email, sheet, drive_file, meet.`);
  }
}

async function handleSend(params: Record<string, unknown>): Promise<HandlerResponse> {
  const id = requireScratchpadId(params);
  if (!id) return scratchpadNotFound(params.scratchpadId as string);

  const target = params.target as string | undefined;
  if (!target) return error('target is required for send (email, email_draft, doc_create, doc_write, workspace).');

  const targetParams = (params.targetParams ?? {}) as Record<string, string>;
  const keep = params.keep !== false; // default true

  let result: HandlerResponse;

  switch (target) {
    case 'email':
      result = await sendEmail(scratchpads, id, targetParams as unknown as Parameters<typeof sendEmail>[2]);
      break;
    case 'email_draft':
      result = await sendEmailDraft(scratchpads, id, targetParams as unknown as Parameters<typeof sendEmailDraft>[2]);
      break;
    case 'doc_create':
      result = await sendDocCreate(scratchpads, id, targetParams as unknown as Parameters<typeof sendDocCreate>[2]);
      break;
    case 'doc_write':
      result = await sendDocWrite(scratchpads, id, targetParams as unknown as Parameters<typeof sendDocWrite>[2]);
      break;
    case 'workspace':
      result = await sendWorkspace(scratchpads, id, targetParams as unknown as Parameters<typeof sendWorkspace>[2]);
      break;
    case 'sheet_write':
      result = await sendSheetWrite(scratchpads, id, targetParams as unknown as Parameters<typeof sendSheetWrite>[2]);
      break;
    case 'calendar_event':
      result = await sendCalendarEvent(scratchpads, id, targetParams as unknown as Parameters<typeof sendCalendarEvent>[2]);
      break;
    case 'task_create':
      result = await sendTaskCreate(scratchpads, id, targetParams as unknown as Parameters<typeof sendTaskCreate>[2]);
      break;
    default:
      return error(`Unknown send target: ${target}. Valid targets: email, email_draft, doc_create, doc_write, workspace, sheet_write, calendar_event, task_create.`);
  }

  // Discard scratchpad on success if keep=false
  if (!keep && !result.refs?.error) {
    scratchpads.discard(id);
    result.text += `\nScratchpad ${id} discarded.`;
  }

  return result;
}
