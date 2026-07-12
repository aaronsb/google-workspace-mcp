/**
 * Send adapters: doc_create and doc_write.
 * doc_create: creates a new Google Doc and writes scratchpad content.
 * doc_write: appends scratchpad content to an existing Google Doc.
 */

import { call } from '../../../google/client.js';
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

/**
 * Append text to the end of a document's body.
 *
 * Was gws's `docs +write`. `documentId` is the only declared path param;
 * `requests` is the batchUpdate body. `endOfSegmentLocation` with an empty
 * `segmentId` means "the end of the document body" — the append semantics the
 * adapter has always claimed.
 */
async function appendText(account: string, documentId: string, text: string): Promise<void> {
  await call('docs', 'documents.batchUpdate', {
    documentId,
    requests: [
      { insertText: { text, endOfSegmentLocation: { segmentId: '' } } },
    ],
  }, { account });
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
    // Step 1: Create empty doc (title is the request body — documents.create
    // declares no path/query params, so it lands in the body).
    const doc = await call('docs', 'documents.create', { title }, { account: email }) as Record<string, unknown>;
    const documentId = doc.documentId as string;

    // Step 2: Write content
    await appendText(email, documentId, content);

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
    await appendText(email, documentId, content);

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
