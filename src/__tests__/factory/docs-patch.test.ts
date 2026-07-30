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
 *
 *  - `get` returned THE FIRST TAB of a multi-tab document and presented it as the whole
 *    file (#152). Google's `body` is a legacy field holding only the first tab unless
 *    documents.get is called with includeTabsContent=true; the reporter's document was
 *    780 lines and came back as 142, with nothing in the response saying so.
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

/** One paragraph of body content, in Google's nesting. */
function para(text: string): Record<string, unknown> {
  return { paragraph: { elements: [{ textRun: { content: `${text}\n` } }] } };
}

/**
 * A multi-tab document as Google ACTUALLY returns it with includeTabsContent=true.
 *
 * Note what is missing: there is no `body`. Verified live against three real documents —
 * with the flag set, Google drops `body`, `headers`, `lists`, `inlineObjects` and
 * `namedStyles` from the response entirely and puts the content under
 * `tabs[].documentTab.body`. This shape is why reading `tabs` first is not a preference:
 * code that reads `body` first returns an EMPTY document for every tabbed file.
 */
function tabbedDoc(): Record<string, unknown> {
  return {
    documentId: 'doc-2',
    title: 'Meeting transcripts',
    revisionId: 'rev-3',
    tabs: [
      {
        tabProperties: { tabId: 't1', title: 'Monday', index: 0 },
        documentTab: { body: { content: [para('Standup on Monday.')] } },
      },
      {
        tabProperties: { tabId: 't2', title: 'Tuesday', index: 1 },
        documentTab: { body: { content: [para('Standup on Tuesday.')] } },
        childTabs: [
          {
            tabProperties: { tabId: 't2a', title: 'Action items', index: 0 },
            documentTab: { body: { content: [para('Ship the fix.')] } },
          },
        ],
      },
      {
        tabProperties: { tabId: 't3', title: 'Wednesday', index: 2 },
        documentTab: { body: { content: [para('Standup on Wednesday.')] } },
      },
    ],
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
      { documentId: 'doc-1', includeTabsContent: true }, { account: ACCOUNT });
  });

  it('ASKS for tab content — without the flag Google returns the first tab only', async () => {
    // The whole bug in one assertion. Google's default is not "the document", it is
    // "tab one", and it says nothing about the difference.
    mockCall.mockResolvedValue(googleDoc());

    await docsPatch.customHandlers!.get({ documentId: 'doc-1' }, ACCOUNT);

    const [, , sentParams] = mockCall.mock.calls[0];
    expect(sentParams).toMatchObject({ includeTabsContent: true });
  });

  it('renders a doc with no tabs exactly as before — body is still the fallback', async () => {
    // Not every response carries `tabs`. The legacy shape must keep working, and it
    // must not grow tab scaffolding it has no tabs for.
    mockCall.mockResolvedValue(googleDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-1' }, ACCOUNT);

    expect(result.text).toContain('First line.');
    expect(result.text).not.toContain('**Tabs:**');
    expect(result.refs.tabs).toBe(0);
  });
});

describe('docsPatch.get — multi-tab documents (#152)', () => {
  it('returns EVERY tab, not just the first', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    expect(result.text).toContain('Standup on Monday.');
    expect(result.text).toContain('Standup on Tuesday.');
    expect(result.text).toContain('Standup on Wednesday.');
  });

  it('descends into childTabs — a nested tab is still document content', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    expect(result.text).toContain('Ship the fix.');
  });

  it('labels each tab, so concatenated transcripts do not read as one', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    expect(result.text).toContain('### Monday');
    expect(result.text).toContain('### Tuesday');
    // A child tab sits one heading level deeper than its parent.
    expect(result.text).toContain('#### Action items');
  });

  it('says how many tabs it read — the response must not be silent about scope', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    // 3 top-level + 1 nested.
    expect(result.text).toContain('**Tabs:** 4');
    expect(result.refs.tabs).toBe(4);
  });

  it('reads a tabbed document that has NO body field — the real Google shape', async () => {
    // The response above carries no `body`. Reading `body` first here returns an empty
    // document while reporting success, which is the original bug wearing a new hat.
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    expect(result.text).not.toContain('the document is empty');
    expect(result.refs.characters).toBeGreaterThan(0);
  });

  it('prefers tabs over body when both are present — no duplicated first tab', async () => {
    // Defensive, not observed live: if Google ever populates both, tab one must not be
    // rendered twice.
    mockCall.mockResolvedValue({
      ...tabbedDoc(),
      body: { content: [para('Standup on Monday.')] },
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    const occurrences = result.text.split('Standup on Monday.').length - 1;
    expect(occurrences).toBe(1);
  });

  it('counts characters across all tabs, not just the one it used to read', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    const total = ['Standup on Monday.', 'Standup on Tuesday.', 'Ship the fix.', 'Standup on Wednesday.']
      .reduce((sum, t) => sum + t.length, 0);
    expect(result.refs.characters).toBe(total);
  });

  it('keeps a single-tab document free of tab scaffolding', async () => {
    // Most documents have exactly one tab. Their output should not change at all.
    mockCall.mockResolvedValue({
      documentId: 'doc-3',
      title: 'Plain',
      tabs: [{
        tabProperties: { tabId: 't1', title: 'Tab 1' },
        documentTab: { body: { content: [para('Just some prose.')] } },
      }],
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-3' }, ACCOUNT);

    expect(result.text).toContain('Just some prose.');
    expect(result.text).not.toContain('### Tab 1');
    expect(result.text).not.toContain('**Tabs:**');
    expect(result.refs.tabs).toBe(1);
  });

  it('marks an empty tab as empty rather than dropping it', async () => {
    // A tab with no content still tells the reader it exists — silently omitting it is
    // the same class of lie as omitting the tab entirely.
    mockCall.mockResolvedValue({
      documentId: 'doc-4',
      title: 'Half-written',
      tabs: [
        { tabProperties: { tabId: 't1', title: 'Draft' }, documentTab: { body: { content: [para('Some notes.')] } } },
        { tabProperties: { tabId: 't2', title: 'Later' }, documentTab: { body: { content: [] } } },
      ],
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-4' }, ACCOUNT);

    expect(result.text).toContain('### Later');
    expect(result.text).toContain('_(this tab is empty)_');
  });

  it('survives a tab with no title and no documentTab', async () => {
    // Defensive: tabProperties.title is not guaranteed, and a malformed tab must not
    // take down the read of the tabs around it.
    mockCall.mockResolvedValue({
      documentId: 'doc-5',
      title: 'Odd',
      tabs: [
        { tabProperties: {} },
        { tabProperties: { title: 'Real' }, documentTab: { body: { content: [para('Content here.')] } } },
      ],
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-5' }, ACCOUNT);

    expect(result.text).toContain('(untitled tab)');
    expect(result.text).toContain('Content here.');
    expect(result.refs.tabs).toBe(2);
  });
});
