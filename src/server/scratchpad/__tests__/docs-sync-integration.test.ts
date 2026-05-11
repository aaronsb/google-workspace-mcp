/**
 * Integration-ish tests for the docs-bound mutation path through the
 * scratchpad handler. Mocks `execute` from the gws executor; everything
 * else is real (ScratchpadManager, the docs-sync translator).
 *
 * Covers the two test cases that the pure-translator tests can't:
 *  - API rejects → local buffer preserved, error response returned.
 *  - API succeeds → reloadDocsBuffer fires, sp.lines replaced from the
 *    fresh response, binding revisionId updated.
 */

jest.mock('../../../executor/gws.js');
jest.mock('../../handler.js', () => ({ getEpoch: () => 0 }));

import { execute } from '../../../executor/gws.js';
import { handleScratchpad } from '../handler.js';
import { getScratchpadManager } from '../handler.js';

const mockExecute = execute as jest.MockedFunction<typeof execute>;

/** Seed a docs-bound JSON scratchpad with a one-paragraph doc and return its id. */
function seedDocsBoundScratchpad(opts?: { revisionId?: string }): string {
  const manager = getScratchpadManager();
  const id = manager.create({ format: 'json' });
  const doc = {
    documentId: 'doc-1',
    revisionId: opts?.revisionId ?? 'rev-1',
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: 13,
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: 13, textRun: { content: 'Hello world\n' } },
            ],
            paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          },
        },
      ],
    },
  };
  const sp = manager.get(id)!;
  sp.lines = JSON.stringify(doc, null, 2).split('\n');
  manager.setBinding(id, {
    service: 'docs', resourceId: 'doc-1', account: 'me@test.com',
    revisionId: opts?.revisionId ?? 'rev-1',
  });
  return id;
}

describe('docs-bound json_set', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('rejects an unsupported path WITHOUT mutating the local buffer (pre-validation)', async () => {
    const id = seedDocsBoundScratchpad();
    const manager = getScratchpadManager();
    const linesBefore = [...manager.get(id)!.lines];

    const result = await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      // textStyle.bold is structural in the supported-path sense — not in the allowlist.
      path: '$.body.content[0].paragraph.elements[0].textStyle.bold',
      value: true,
    });

    expect(result.text).toMatch(/rejected/);
    expect(result.text).toMatch(/not supported/);
    // Pre-validation contract: the buffer is untouched on rejection.
    expect(manager.get(id)!.lines).toEqual(linesBefore);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('on API success, pushes batchUpdate and reloads the buffer from documents.get', async () => {
    const id = seedDocsBoundScratchpad({ revisionId: 'rev-1' });
    const manager = getScratchpadManager();

    // First call: batchUpdate succeeds.
    // Second call: documents.get returns the fresh doc (with bumped revisionId).
    mockExecute
      .mockResolvedValueOnce({ success: true, data: {}, stderr: '' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          documentId: 'doc-1',
          revisionId: 'rev-2',
          body: {
            content: [{
              startIndex: 1,
              endIndex: 9,
              paragraph: {
                elements: [{ startIndex: 1, endIndex: 9, textRun: { content: 'Goodbye\n' } }],
                paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
              },
            }],
          },
        },
        stderr: '',
      });

    const result = await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.body.content[0].paragraph.elements[0].textRun.content',
      value: 'Goodbye',
    });

    expect(result.refs.synced).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(2);

    // First call: batchUpdate with the translated request + writeControl.
    const batchArgs = mockExecute.mock.calls[0][0];
    expect(batchArgs.slice(0, 3)).toEqual(['docs', 'documents', 'batchUpdate']);
    const body = JSON.parse(batchArgs[batchArgs.indexOf('--json') + 1]);
    expect(body.requests[0]).toEqual({ deleteContentRange: { range: { startIndex: 1, endIndex: 12 } } });
    expect(body.requests[1]).toEqual({ insertText: { text: 'Goodbye', location: { index: 1 } } });
    expect(body.writeControl).toEqual({ requiredRevisionId: 'rev-1' });

    // Second call: documents.get for the reload.
    expect(mockExecute.mock.calls[1][0].slice(0, 3)).toEqual(['docs', 'documents', 'get']);

    // Buffer reloaded from fresh response.
    const reloaded = JSON.parse(manager.get(id)!.lines.join('\n'));
    expect(reloaded.revisionId).toBe('rev-2');
    expect(reloaded.body.content[0].paragraph.elements[0].textRun.content).toBe('Goodbye\n');
    // Binding revisionId advanced for the NEXT sync.
    expect(manager.getBinding(id)?.revisionId).toBe('rev-2');
  });

  it('on API rejection, preserves the local buffer change and returns an error', async () => {
    const id = seedDocsBoundScratchpad({ revisionId: 'rev-1' });
    const manager = getScratchpadManager();

    // Simulate the API rejecting (e.g., stale requiredRevisionId).
    mockExecute.mockRejectedValueOnce(new Error('precondition failed: revisionId mismatch'));

    const result = await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.body.content[0].paragraph.elements[0].textRun.content',
      value: 'Goodbye',
    });

    expect(result.refs.error).toBe(true);
    expect(result.text).toMatch(/Sync failed/);
    expect(result.text).toMatch(/Retry or use scratchpad reset to discard/);

    // The batchUpdate was attempted; the reload (second call) was NOT.
    expect(mockExecute).toHaveBeenCalledTimes(1);

    // Local buffer holds the would-have-synced change — agent retries or discards.
    const buffer = JSON.parse(manager.get(id)!.lines.join('\n'));
    expect(buffer.body.content[0].paragraph.elements[0].textRun.content).toBe('Goodbye');
    // Binding revisionId did NOT advance — still the original.
    expect(manager.getBinding(id)?.revisionId).toBe('rev-1');
  });

  it('json_delete on a docs-bound scratchpad is rejected (structural)', async () => {
    const id = seedDocsBoundScratchpad();
    const manager = getScratchpadManager();
    const linesBefore = [...manager.get(id)!.lines];

    const result = await handleScratchpad({
      operation: 'json_delete',
      scratchpadId: id,
      path: '$.body.content[0]',
    });

    expect(result.text).toMatch(/rejected/);
    expect(result.text).toMatch(/structural/);
    expect(manager.get(id)!.lines).toEqual(linesBefore);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('omits writeControl when the binding has no revisionId (legacy import)', async () => {
    const id = seedDocsBoundScratchpad({ revisionId: undefined });
    // Need to clear it explicitly — the seed helper defaults to 'rev-1'.
    const manager = getScratchpadManager();
    manager.setBinding(id, { service: 'docs', resourceId: 'doc-1', account: 'me@test.com' });

    mockExecute
      .mockResolvedValueOnce({ success: true, data: {}, stderr: '' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          documentId: 'doc-1',
          revisionId: 'rev-9',
          body: { content: [{
            startIndex: 1, endIndex: 13,
            paragraph: {
              elements: [{ startIndex: 1, endIndex: 13, textRun: { content: 'Hello world\n' } }],
              paragraphStyle: {},
            },
          }] },
        },
        stderr: '',
      });

    await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.body.content[0].paragraph.elements[0].textRun.content',
      value: 'X',
    });

    const body = JSON.parse(mockExecute.mock.calls[0][0][mockExecute.mock.calls[0][0].indexOf('--json') + 1]);
    expect(body.writeControl).toBeUndefined();
    // But the reload picks up a fresh revisionId for the next sync.
    expect(manager.getBinding(id)?.revisionId).toBe('rev-9');
  });
});
