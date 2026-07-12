/**
 * The default formatters — what an operation says when no patch shapes its response.
 *
 * The action formatter is the one that matters here. Google does not agree with itself
 * about what an identifier is called (`id` in Tasks, `documentId` in Docs,
 * `spreadsheetId` in Sheets), and the formatter only recognised the literal key `id`.
 * So `manage_docs create` returned, in full: "Operation completed." No id, no title —
 * an agent reading the response text had nothing to act on.
 */
import { describe, expect, it } from 'vitest';

import { formatDefault } from '../../factory/defaults.js';
import type { OperationDef } from '../../factory/types.js';

const action = { type: 'action', description: '', resource: 'x.y' } as OperationDef;

describe('formatDefault — action', () => {
  it('names the resource when Google calls the id `documentId`', () => {
    // The regression: a Docs create response carries no key called `id`.
    const res = formatDefault({ documentId: 'doc-1', title: 'Quarterly numbers' }, action);

    expect(res.text).toContain('doc-1');
    expect(res.text).toContain('Quarterly numbers');
    expect(res.text).toContain('Document ID');
    // refs.id stays populated whatever Google named the field, so $N.id chaining works.
    expect(res.refs.id).toBe('doc-1');
  });

  it('still handles a plain `id` (Tasks) and shows the title', () => {
    const res = formatDefault({ id: 'task-1', title: 'buy milk' }, action);

    expect(res.text).toContain('task-1');
    expect(res.text).toContain('buy milk');
    expect(res.refs.id).toBe('task-1');
  });

  it('handles spreadsheetId', () => {
    const res = formatDefault({ spreadsheetId: 'sheet-1', properties: { title: 'Budget' } }, action);

    expect(res.text).toContain('sheet-1');
    expect(res.refs.id).toBe('sheet-1');
  });

  it('does not claim an id it was not given', () => {
    // A response with no identifier at all must not invent one — and must still confirm.
    const res = formatDefault({}, action);

    expect(res.text).toContain('Operation completed.');
    expect(res.text).not.toContain('ID:');
  });
});
