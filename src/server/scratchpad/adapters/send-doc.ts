/**
 * Send adapters: doc_create and doc_write.
 * doc_create: creates a new Google Doc and writes scratchpad content.
 * doc_write: appends scratchpad content to an existing Google Doc.
 */

import { execute } from '../../../executor/gws.js';
import type { HandlerResponse } from '../../handler.js';
import type { ScratchpadManager } from '../manager.js';

interface DocCreateParams {
  email: string;
  title: string;
}

interface DocWriteParams {
  email: string;
  documentId: string;
}

export async function sendDocCreate(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  targetParams: DocCreateParams,
): Promise<HandlerResponse> {
  const content = scratchpads.getContent(scratchpadId);
  if (content === null) {
    return { text: `Scratchpad ${scratchpadId} not found.`, refs: { error: true } };
  }

  const { email, title } = targetParams;
  if (!email || !title) {
    return {
      text: `Send failed: email and title are required for doc_create.\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  try {
    // Step 1: Create empty doc (title goes in --json request body)
    const createResult = await execute([
      'docs', 'documents', 'create',
      '--json', JSON.stringify({ title }),
    ], { account: email });

    const doc = createResult.data as Record<string, unknown>;
    const documentId = doc.documentId as string;

    // Step 2: Write content
    await execute([
      'docs', '+write',
      '--document', documentId,
      '--text', content,
    ], { account: email });

    return {
      text: `Document created from scratchpad.\n\n**Title:** ${title}\n**Document ID:** ${documentId}`,
      refs: { scratchpadId, documentId, title },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}

export async function sendDocWrite(
  scratchpads: ScratchpadManager,
  scratchpadId: string,
  targetParams: DocWriteParams,
): Promise<HandlerResponse> {
  const content = scratchpads.getContent(scratchpadId);
  if (content === null) {
    return { text: `Scratchpad ${scratchpadId} not found.`, refs: { error: true } };
  }

  const { email, documentId } = targetParams;
  if (!email || !documentId) {
    return {
      text: `Send failed: email and documentId are required for doc_write.\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }

  try {
    await execute([
      'docs', '+write',
      '--document', documentId,
      '--text', content,
    ], { account: email });

    return {
      text: `Content appended to document ${documentId}.`,
      refs: { scratchpadId, documentId },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      text: `Send failed: ${message}\nScratchpad ${scratchpadId} is still active.`,
      refs: { error: true, scratchpadId },
    };
  }
}
