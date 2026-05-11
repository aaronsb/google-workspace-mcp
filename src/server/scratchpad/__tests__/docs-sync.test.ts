/**
 * Tests for docs-sync — translating a scratchpad JSON-mode mutation into
 * a Docs batchUpdate request. Pure translator; no API calls (mocked or
 * otherwise) in this file. See issue #79.
 */

import { translateMutation, isRejection } from '../docs-sync.js';
import type { DocsSyncIntent } from '../docs-sync.js';

/** Minimal Docs-API-shaped JSON with one body content element. */
function docWith(element: Record<string, unknown>, revisionId = 'rev-1'): string {
  return JSON.stringify({
    documentId: 'doc-1',
    revisionId,
    body: { content: [element] },
  });
}

/** Helper — a textRun element. content/startIndex/endIndex configurable. */
function textRunElement(content: string, startIndex: number): Record<string, unknown> {
  return {
    startIndex,
    endIndex: startIndex + content.length,
    paragraph: {
      elements: [
        { startIndex, endIndex: startIndex + content.length, textRun: { content } },
      ],
      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
    },
  };
}

const TEXT_PATH = '$.body.content[0].paragraph.elements[0].textRun.content';
const STYLE_PATH = '$.body.content[0].paragraph.paragraphStyle.namedStyleType';

describe('translateMutation — textRun.content path', () => {
  it('builds deleteContentRange(start, end-1) + insertText when old content ends with \\n', () => {
    // Trailing newline is the paragraph break — must not delete through it,
    // or the paragraph itself disappears.
    const beforeJson = docWith(textRunElement('Hello world\n', 1)); // endIndex = 13
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'Goodbye', beforeJson },
      'rev-1',
    );
    if (isRejection(result)) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.body.requests).toEqual([
      { deleteContentRange: { range: { startIndex: 1, endIndex: 12 } } }, // end - 1 = 13 - 1
      { insertText: { text: 'Goodbye', location: { index: 1 } } },
    ]);
    expect(result.body.writeControl).toEqual({ requiredRevisionId: 'rev-1' });
  });

  it('builds deleteContentRange(start, end) when old content has no trailing newline', () => {
    const beforeJson = docWith(textRunElement('inline', 5));            // endIndex = 11, no trailing \n
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'inlined', beforeJson },
      'rev-1',
    );
    if (isRejection(result)) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.body.requests).toEqual([
      { deleteContentRange: { range: { startIndex: 5, endIndex: 11 } } },
      { insertText: { text: 'inlined', location: { index: 5 } } },
    ]);
  });

  it('omits deleteContentRange when the run is just a paragraph-break newline', () => {
    // oldContent='\n' → deleteEnd = endIndex - 1 = startIndex; nothing to delete.
    const beforeJson = docWith(textRunElement('\n', 7));
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'X', beforeJson },
      'rev-1',
    );
    if (isRejection(result)) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.body.requests).toEqual([
      { insertText: { text: 'X', location: { index: 7 } } },
    ]);
  });

  it('rejects a newline in the new value (structural edit disguised as text)', () => {
    const beforeJson = docWith(textRunElement('Hello\n', 1));
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'line1\nline2', beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/newline/);
  });

  it('rejects a non-string value', () => {
    const beforeJson = docWith(textRunElement('x', 1));
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 42, beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/string/);
  });

  it('rejects when the element has no textRun (e.g. an inline image)', () => {
    const beforeJson = docWith({
      startIndex: 1,
      endIndex: 2,
      paragraph: {
        elements: [{ startIndex: 1, endIndex: 2, inlineObjectElement: { objectId: 'img-1' } }],
      },
    });
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'x', beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/textRun/);
  });
});

describe('translateMutation — paragraphStyle path', () => {
  it('builds updateParagraphStyle with the element range and the leaf field mask', () => {
    const beforeJson = docWith(textRunElement('Heading text\n', 1));
    const result = translateMutation(
      { op: 'set', path: STYLE_PATH, value: 'HEADING_1', beforeJson },
      'rev-1',
    );
    if (isRejection(result)) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.body.requests).toEqual([{
      updateParagraphStyle: {
        range: { startIndex: 1, endIndex: 14 }, // 'Heading text\n'.length = 13
        paragraphStyle: { namedStyleType: 'HEADING_1' },
        fields: 'namedStyleType',
      },
    }]);
    expect(result.body.writeControl).toEqual({ requiredRevisionId: 'rev-1' });
  });

  it('passes the leaf field name through unchanged (alignment, direction, etc.)', () => {
    const beforeJson = docWith(textRunElement('x\n', 1));
    const result = translateMutation(
      { op: 'set', path: '$.body.content[0].paragraph.paragraphStyle.alignment', value: 'CENTER', beforeJson },
      'rev-1',
    );
    if (isRejection(result)) throw new Error(`unexpected rejection: ${result.reason}`);
    const r = result.body.requests[0] as Record<string, Record<string, unknown>>;
    expect(r.updateParagraphStyle.fields).toBe('alignment');
    expect(r.updateParagraphStyle.paragraphStyle).toEqual({ alignment: 'CENTER' });
  });

  it('rejects when the element is not a paragraph', () => {
    const beforeJson = docWith({
      startIndex: 1, endIndex: 5,
      table: { rows: 1, columns: 1 },
    });
    const result = translateMutation(
      { op: 'set', path: STYLE_PATH, value: 'HEADING_1', beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/paragraph/);
  });
});

describe('translateMutation — rejected paths and ops', () => {
  it('rejects an unsupported path with a guidance message', () => {
    const beforeJson = docWith(textRunElement('x\n', 1));
    const result = translateMutation(
      { op: 'set', path: '$.body.content[0].paragraph.elements[0].textStyle.bold', value: true, beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) {
      expect(result.reason).toMatch(/not supported/);
      expect(result.reason).toMatch(/markdown mode/);
    }
  });

  it('rejects json_delete on a docs-bound scratchpad (structural)', () => {
    const beforeJson = docWith(textRunElement('x\n', 1));
    const result = translateMutation(
      { op: 'delete', path: TEXT_PATH, beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/structural/);
  });

  it('rejects json_insert on a docs-bound scratchpad (structural)', () => {
    const beforeJson = docWith(textRunElement('x\n', 1));
    const result = translateMutation(
      { op: 'insert', path: '$.body.content', value: { paragraph: {} }, beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/structural/);
  });

  it('rejects when the element index is out of range', () => {
    const beforeJson = docWith(textRunElement('x\n', 1));
    const result = translateMutation(
      { op: 'set', path: '$.body.content[5].paragraph.elements[0].textRun.content', value: 'y', beforeJson },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/not found/);
  });

  it('rejects on a malformed buffer JSON (caller surfaces "fix syntax first")', () => {
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'x', beforeJson: '{ this is not valid JSON' },
      'rev-1',
    );
    expect(isRejection(result)).toBe(true);
    if (isRejection(result)) expect(result.reason).toMatch(/JSON/);
  });
});

describe('translateMutation — writeControl.requiredRevisionId', () => {
  it('omits writeControl when no revisionId is provided', () => {
    // E.g. an older import that didn't capture a revisionId. The API still
    // accepts the request, just without optimistic-concurrency protection.
    const beforeJson = docWith(textRunElement('x\n', 1));
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'y', beforeJson },
      undefined,
    );
    if (isRejection(result)) throw new Error('unexpected rejection');
    expect(result.body.writeControl).toBeUndefined();
  });

  it('includes writeControl for paragraphStyle changes as well as text', () => {
    const beforeJson = docWith(textRunElement('x\n', 1));
    const text = translateMutation({ op: 'set', path: TEXT_PATH, value: 'y', beforeJson }, 'rev-42');
    const style = translateMutation({ op: 'set', path: STYLE_PATH, value: 'HEADING_2', beforeJson }, 'rev-42');
    if (isRejection(text) || isRejection(style)) throw new Error('unexpected rejection');
    expect(text.body.writeControl).toEqual({ requiredRevisionId: 'rev-42' });
    expect(style.body.writeControl).toEqual({ requiredRevisionId: 'rev-42' });
  });
});

describe('translateMutation — summary', () => {
  it('summary names the path and (for text) the length delta', () => {
    const beforeJson = docWith(textRunElement('Hello\n', 1));
    const result = translateMutation(
      { op: 'set', path: TEXT_PATH, value: 'Goodbye', beforeJson },
      'rev-1',
    );
    if (isRejection(result)) throw new Error('unexpected rejection');
    expect(result.summary).toMatch(/content\[0\].elements\[0\]/);
    // 'Hello\n'.length = 6, 'Goodbye'.length = 7
    expect(result.summary).toMatch(/6 → 7/);
  });

  it('summary names the paragraphStyle field for style changes', () => {
    const beforeJson = docWith(textRunElement('x\n', 1));
    const result = translateMutation(
      { op: 'set', path: STYLE_PATH, value: 'HEADING_1', beforeJson },
      'rev-1',
    );
    if (isRejection(result)) throw new Error('unexpected rejection');
    expect(result.summary).toMatch(/paragraphStyle\.namedStyleType/);
  });
});

/**
 * Suggested next pass — handler-level integration tests that mock `execute`
 * to cover the API-error-preserves-buffer and success-reloads-buffer cases.
 * Co-located with this file would be reasonable; a separate file under the
 * same dir keeps the unit-vs-integration split clear.
 *
 *  - API rejects (stale revisionId, structural error) → buffer preserved.
 *  - API succeeds → reloadDocsBuffer fires, sp.lines replaced, binding
 *    revisionId updated from the fresh response.
 */
