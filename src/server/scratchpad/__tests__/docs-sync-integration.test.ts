/**
 * Integration-ish tests for the docs-bound mutation path through the
 * scratchpad handler. Mocks `call` from the Google API client; everything
 * else is real (ScratchpadManager, the docs-sync translator).
 *
 * Covers the two test cases that the pure-translator tests can't:
 *  - API rejects → local buffer preserved, error response returned.
 *  - API succeeds → reloadDocsBuffer fires, sp.lines replaced from the
 *    fresh response, binding revisionId updated.
 */
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

// The docs sync path is a RESOURCE path: documents.batchUpdate / documents.get
// go through the Google API client we own (ADR-103). A mocked `call()` resolves
// to raw Google JSON — there is no { success, data, stderr } envelope.
vi.mock('../../../google/client.js');
vi.mock('../../handler.js', () => ({ getEpoch: () => 0 }));

import { call } from '../../../google/client.js';
import { handleScratchpad } from '../handler.js';
import { getScratchpadManager } from '../handler.js';
import { requestFor } from '../../../__tests__/support/request.js';

const mockCall = call as MockedFunction<typeof call>;

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
    mockCall.mockReset();
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
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('on API success, pushes batchUpdate and reloads the buffer from documents.get', async () => {
    const id = seedDocsBoundScratchpad({ revisionId: 'rev-1' });
    const manager = getScratchpadManager();

    // First call: batchUpdate succeeds.
    // Second call: documents.get returns the fresh doc (with bumped revisionId).
    mockCall
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
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
      });

    const result = await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.body.content[0].paragraph.elements[0].textRun.content',
      value: 'Goodbye',
    });

    expect(result.refs.synced).toBe(true);
    expect(mockCall).toHaveBeenCalledTimes(2);

    // First call: batchUpdate with the translated request + writeControl.
    const [service, resourcePath, params, options] = mockCall.mock.calls[0];
    expect(service).toBe('docs');
    expect(resourcePath).toBe('documents.batchUpdate');
    expect(options).toMatchObject({ account: 'me@test.com' });
    expect(params.documentId).toBe('doc-1');
    const requests = params.requests as Array<Record<string, unknown>>;
    expect(requests[0]).toEqual({ deleteContentRange: { range: { startIndex: 1, endIndex: 12 } } });
    expect(requests[1]).toEqual({ insertText: { text: 'Goodbye', location: { index: 1 } } });
    expect(params.writeControl).toEqual({ requiredRevisionId: 'rev-1' });

    // …and the descriptor puts requests/writeControl in the POST body, with only
    // documentId in the path. (The old assertion read this off a `--json` argv
    // slot; this reads it off what Google actually declares.)
    const request = await requestFor('docs', 'documents.batchUpdate', params);
    expect(request.method).toBe('POST');
    expect(request.body).toEqual({ requests, writeControl: { requiredRevisionId: 'rev-1' } });
    expect(request.url).toContain('/documents/doc-1:batchUpdate');

    // Second call: documents.get for the reload — WITH includeTabsContent, in step with
    // the import that created the buffer. Drop the flag here and the reload replaces a
    // tabbed buffer with a tabless one: every `$.tabs[T]…` path the agent holds stops
    // resolving, and a `$.body…` path starts translating WITHOUT a tabId, so the next
    // write silently goes to the first tab. Nothing else in the suite guards that line.
    expect(mockCall.mock.calls[1][1]).toBe('documents.get');
    expect(mockCall.mock.calls[1][2]).toEqual({ documentId: 'doc-1', includeTabsContent: true });

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
    mockCall.mockRejectedValueOnce(new Error('precondition failed: revisionId mismatch'));

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
    expect(mockCall).toHaveBeenCalledTimes(1);

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
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('omits writeControl when the binding has no revisionId (legacy import)', async () => {
    const id = seedDocsBoundScratchpad({ revisionId: undefined });
    // Need to clear it explicitly — the seed helper defaults to 'rev-1'.
    const manager = getScratchpadManager();
    manager.setBinding(id, { service: 'docs', resourceId: 'doc-1', account: 'me@test.com' });

    mockCall
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        documentId: 'doc-1',
        revisionId: 'rev-9',
        body: { content: [{
          startIndex: 1, endIndex: 13,
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 13, textRun: { content: 'Hello world\n' } }],
            paragraphStyle: {},
          },
        }] },
      });

    await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.body.content[0].paragraph.elements[0].textRun.content',
      value: 'X',
    });

    expect(mockCall.mock.calls[0][2].writeControl).toBeUndefined();
    // But the reload picks up a fresh revisionId for the next sync.
    expect(manager.getBinding(id)?.revisionId).toBe('rev-9');
  });
});

/**
 * The round trip agents ACTUALLY take since #155: the buffer arrives with
 * `includeTabsContent`, so content sits under `tabs[].documentTab.body` and there is no
 * root `body` at all. Everything above seeds the tabless shape, which nothing this
 * codebase requests still produces — so without these, the live path has no coverage.
 */
describe('docs-bound json_set — tabbed buffer (#155)', () => {
  beforeEach(() => {
    mockCall.mockReset();
  });

  /** A two-tab document in the shape Google returns WITH the flag: no root `body`. */
  function tabbedDoc(revisionId: string, secondTabText: string) {
    const para = (text: string, startIndex: number) => ({
      startIndex,
      endIndex: startIndex + text.length,
      paragraph: {
        elements: [{ startIndex, endIndex: startIndex + text.length, textRun: { content: text } }],
        paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
      },
    });
    return {
      documentId: 'doc-1',
      revisionId,
      tabs: [
        {
          tabProperties: { tabId: 't.first', title: 'Notes' },
          documentTab: { body: { content: [para('First tab text\n', 1)] } },
        },
        {
          tabProperties: { tabId: 't.second', title: 'Transcript' },
          documentTab: { body: { content: [para(secondTabText, 1)] } },
        },
      ],
    };
  }

  function seedTabbed(): string {
    const manager = getScratchpadManager();
    const id = manager.create({ format: 'json' });
    manager.get(id)!.lines = JSON.stringify(tabbedDoc('rev-1', 'Second tab text\n'), null, 2).split('\n');
    manager.setBinding(id, {
      service: 'docs', resourceId: 'doc-1', account: 'me@test.com', revisionId: 'rev-1',
    });
    return id;
  }

  it('carries the addressed tab id onto every request, so the edit cannot land in tab one', async () => {
    const id = seedTabbed();
    mockCall
      .mockResolvedValueOnce({ replies: [{}] })
      .mockResolvedValueOnce(tabbedDoc('rev-2', 'Rewritten\n'));

    await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.tabs[1].documentTab.body.content[0].paragraph.elements[0].textRun.content',
      value: 'Rewritten',
    });

    const params = mockCall.mock.calls[0][2] as Record<string, unknown>;
    const requests = params.requests as Array<Record<string, unknown>>;
    // Both the delete and the insert name the SECOND tab. Without tabId, Google resolves
    // to the first tab and applies an index measured in the second — silently.
    // 'Second tab text\n' is 16 chars from index 1, so endIndex is 17 — and the delete
    // stops at 16 to leave the paragraph break intact.
    expect(requests[0]).toEqual({
      deleteContentRange: { range: { startIndex: 1, endIndex: 16, tabId: 't.second' } },
    });
    expect(requests[1]).toEqual({
      insertText: { text: 'Rewritten', location: { index: 1, tabId: 't.second' } },
    });
  });

  it('reloads in the tabbed shape, so the paths that translated still resolve after a push', async () => {
    const id = seedTabbed();
    const manager = getScratchpadManager();
    mockCall
      .mockResolvedValueOnce({ replies: [{}] })
      .mockResolvedValueOnce(tabbedDoc('rev-2', 'Rewritten\n'));

    await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.tabs[1].documentTab.body.content[0].paragraph.elements[0].textRun.content',
      value: 'Rewritten',
    });

    expect(mockCall.mock.calls[1][2]).toEqual({ documentId: 'doc-1', includeTabsContent: true });
    const reloaded = JSON.parse(manager.get(id)!.lines.join('\n'));
    expect(reloaded.body).toBeUndefined();
    expect(reloaded.tabs[1].documentTab.body.content[0].paragraph.elements[0].textRun.content)
      .toBe('Rewritten\n');
    expect(manager.getBinding(id)?.revisionId).toBe('rev-2');
  });

  it('refuses a $.body path against a tabbed buffer rather than writing untagged', async () => {
    // The legacy shape is still translated for a tabless response. Against a TABBED
    // buffer it must fail: translating it would emit a request with no tabId, which
    // Google applies to the first tab — a wrong-tab write reporting success.
    const id = seedTabbed();
    mockCall.mockResolvedValue({ replies: [{}] });

    const result = await handleScratchpad({
      operation: 'json_set',
      scratchpadId: id,
      path: '$.body.content[0].paragraph.elements[0].textRun.content',
      value: 'X',
    });

    expect(result.refs.error).toBe(true);
    // And nothing was sent to Google.
    expect(mockCall).not.toHaveBeenCalled();
  });
});
