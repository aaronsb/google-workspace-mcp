/**
 * Tests for the docs service patch.
 *
 * Both behaviours here were found by driving the real tool against real Google, not by
 * reading the code — and neither produced an error when it was broken, which is why
 * nothing caught them:
 *
 *  - `get` is described as "get document content and metadata" and returned ONLY
 *    metadata. Google nests the text in body.content[].paragraph.elements[].textRun,
 *    and the generic formatter renders top-level scalars, so every document came back
 *    without a word of its content.
 *
 *  - `create` silently discarded a title. `title` was not in the manifest at all, so
 *    the argument vanished with no error and every document was "Untitled document".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../google/client.js');
import { mockCall } from '../server/handlers/__mocks__/client.js';
import { docsPatch } from '../../services/docs/patch.js';

const ACCOUNT = 'user@test.com';

/** A document as GOOGLE returns it: text nested, nothing readable at the top level. */
function googleDoc(): Record<string, unknown> {
  return {
    documentId: 'doc-1',
    title: 'Quarterly numbers',
    revisionId: 'rev-9',
    body: {
      content: [
        { paragraph: { elements: [{ textRun: { content: 'First line.\n' } }] } },
        { paragraph: { elements: [
          { textRun: { content: 'Second ' } },
          { textRun: { content: 'line, split across runs.\n' } },
        ] } },
        // A table — its cells nest further `content` arrays. A flat walk loses these.
        { table: { tableRows: [
          { tableCells: [
            { content: [{ paragraph: { elements: [{ textRun: { content: 'cell A\n' } }] } }] },
            { content: [{ paragraph: { elements: [{ textRun: { content: 'cell B\n' } }] } }] },
          ] },
        ] } },
      ],
    },
  };
}

beforeEach(() => {
  mockCall.mockReset();
});

describe('docsPatch.get', () => {
  it('returns the document TEXT, not just its metadata', async () => {
    mockCall.mockResolvedValue(googleDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-1' }, ACCOUNT);

    // The regression: this is what the tool promises and used to omit entirely.
    expect(result.text).toContain('First line.');
    expect(result.text).toContain('Second line, split across runs.');
    // Runs split mid-sentence must be joined, not newline-separated.
    expect(result.text).not.toContain('Second \nline');
    // …and metadata is still there.
    expect(result.text).toContain('Quarterly numbers');
    expect(result.refs.documentId).toBe('doc-1');
  });

  it('descends into tables — a doc with a table does not lose its cells', async () => {
    mockCall.mockResolvedValue(googleDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-1' }, ACCOUNT);

    expect(result.text).toContain('cell A');
    expect(result.text).toContain('cell B');
  });

  it('says so plainly when the document really is empty', async () => {
    // An empty doc must be distinguishable from a doc whose text we failed to find —
    // the failure mode being fixed here looked exactly like an empty document.
    mockCall.mockResolvedValue({ documentId: 'doc-1', title: 'Blank', body: { content: [] } });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-1' }, ACCOUNT);

    expect(result.text).toContain('empty');
    expect(result.refs.characters).toBe(0);
  });

  it('reads the document once — the text is already in the response', async () => {
    mockCall.mockResolvedValue(googleDoc());

    await docsPatch.customHandlers!.get({ documentId: 'doc-1' }, ACCOUNT);

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall).toHaveBeenCalledWith('docs', 'documents.get',
      { documentId: 'doc-1' }, { account: ACCOUNT });
  });
});
