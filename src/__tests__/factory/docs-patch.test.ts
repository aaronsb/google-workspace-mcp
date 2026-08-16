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
import { queryOf, requestFor } from '../support/request.js';
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

  it('puts includeTabsContent on the WIRE, as a query parameter', async () => {
    // Every other assertion in this file inspects a MOCKED `call()`, which sits above
    // the path/query/body split. That split is where the flag can die silently: if
    // `includeTabsContent` ever loses `location: query` in the descriptor — regenerated
    // routinely, per ADR-103 — splitParams routes it to the request BODY, buildRequest
    // drops the body on a GET, and Google returns the first tab again. #152 would be
    // back with this entire suite still green. So check the real request.
    const request = await requestFor('docs', 'documents.get', {
      documentId: 'doc-1',
      includeTabsContent: true,
    });

    expect(queryOf(request)).toMatchObject({ includeTabsContent: 'true' });
    expect(request.body).toBeUndefined();
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

  it('does not call an UNREAD tab empty — a failed read is not a blank page', async () => {
    // Google returned tabProperties but no documentTab for any tab. Reporting that as
    // "this tab is empty" tells the reader the document is blank, which is the exact
    // substitution this fix exists to stop: "I could not see it" is not "there is
    // nothing there".
    mockCall.mockResolvedValue({
      documentId: 'doc-6',
      title: 'Unreadable',
      tabs: [
        { tabProperties: { title: 'One' } },
        { tabProperties: { title: 'Two' } },
      ],
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-6' }, ACCOUNT);

    expect(result.text).not.toContain('this tab is empty');
    expect(result.text).toContain('not the same as empty');
    // …and the response says so up front rather than leaving it to be inferred.
    expect(result.text).toContain('2 tab(s) returned no content');
    expect(result.refs.unreadTabs).toBe(2);
  });

  it('falls back to body when a lone tab reports no content', async () => {
    // The `??` bug: tabs[0].text was '' — not nullish — so a populated `body` was
    // discarded and a document with content in it reported as empty.
    mockCall.mockResolvedValue({
      documentId: 'doc-7',
      title: 'One empty tab',
      tabs: [{ tabProperties: { title: 'Tab 1' }, documentTab: { body: { content: [] } } }],
      body: { content: [para('real content here')] },
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-7' }, ACCOUNT);

    expect(result.text).toContain('real content here');
    expect(result.text).not.toContain('the document is empty');
    expect(result.refs.characters).toBe('real content here'.length);
  });

  it('counts characters and lines against the same text', async () => {
    // Both numbers must describe document TEXT. `lines` used to count the rendered
    // output — headings, placeholders, blank separators — so it could not be reconciled
    // with `characters` sitting next to it in the same sentence.
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    // Four tabs, one line of text each.
    expect(result.refs.lines).toBe(4);
    expect(result.text).toContain('**Length:** 71 characters, 4 line(s)');
  });

  it('distinguishes top-level tabs from nested ones in the count', async () => {
    // The Docs tab strip shows 3 for this document; a bare "Tabs: 4" contradicts it with
    // no way for the reader to tell which is wrong.
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    expect(result.text).toContain('**Tabs:** 4 (3 top-level, 1 nested)');
  });

  it('says how to make read and write agree on a tab', async () => {
    // get spans tabs and character indices do not. An agent that computes an index from
    // this output and omits tabId writes to the first tab (#157) — so the response has to
    // name the handle that makes the two coordinate systems one.
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    expect(result.text).toContain('Indices in this response are per-tab');
    expect(result.text).toContain('`tabId`');
    expect(result.text).toContain('FIRST tab');
  });

  it('flags a response that carries no tab data at all', async () => {
    // With the flag set, every real document returned at least one tab. None is an
    // anomaly, and `body` may be the first tab of several — so do not present it as
    // the document without qualification.
    mockCall.mockResolvedValue({
      documentId: 'doc-8',
      title: 'No tabs field',
      body: { content: [para('Could be tab one of ten.')] },
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-8' }, ACCOUNT);

    expect(result.text).toContain('Could be tab one of ten.');
    expect(result.text).toContain('may be the first tab only');
  });

  it('exposes the tab index in refs even when the heading is suppressed', async () => {
    // A one-tab document whose tab the user RENAMED: the title is real content, and the
    // rendered output deliberately omits it.
    mockCall.mockResolvedValue({
      documentId: 'doc-9',
      title: 'Untitled document',
      tabs: [{
        tabProperties: { tabId: 't9', title: 'Q3 Financial Model' },
        documentTab: { body: { content: [para('numbers')] } },
      }],
    });

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-9' }, ACCOUNT);

    expect(result.text).not.toContain('Q3 Financial Model');
    expect(result.refs.tabIndex).toEqual([
      { tabId: 't9', title: 'Q3 Financial Model', depth: 0, characters: 'numbers'.length },
    ]);
  });

  it('carries every tab id — the only handle a scoped read or a write can use', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    // Nested tabs included: a child tab is addressable exactly like a top-level one.
    expect((result.refs.tabIndex as Array<{ tabId: string }>).map((t) => t.tabId))
      .toEqual(['t1', 't2', 't2a', 't3']);
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

describe('docsPatch.get — scoping a read to one tab (#158)', () => {
  it('returns only the named tab', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get(
      { documentId: 'doc-2', tabId: 't2' }, ACCOUNT);

    expect(result.text).toContain('Standup on Tuesday.');
    expect(result.text).not.toContain('Standup on Monday.');
    expect(result.text).not.toContain('Standup on Wednesday.');
    // A child tab is its own tab, not part of its parent's read.
    expect(result.text).not.toContain('Ship the fix.');
  });

  it('addresses a nested tab as readily as a top-level one', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get(
      { documentId: 'doc-2', tabId: 't2a' }, ACCOUNT);

    expect(result.text).toContain('Ship the fix.');
    expect(result.refs.characters).toBe('Ship the fix.'.length);
  });

  it('says the read was scoped, and how much of the document it left out', async () => {
    // `Length` for a scoped read describes ONE tab. Beside a document the caller knows
    // has four, an unqualified number is exactly the under-report of #152.
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get(
      { documentId: 'doc-2', tabId: 't1' }, ACCOUNT);

    expect(result.text).toContain('**Tab:** Monday (`t1`) — 1 of 4');
    expect(result.refs.tabId).toBe('t1');
    expect(result.refs.tabsInDocument).toBe(4);
  });

  it('renders one tab bare — no scaffolding, no cross-tab caveat', async () => {
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get(
      { documentId: 'doc-2', tabId: 't1' }, ACCOUNT);

    expect(result.text).not.toContain('### Monday');
    expect(result.text).not.toContain('Indices in this response are per-tab');
  });

  it('fails loudly on a tabId that matches nothing, and lists the real ones', async () => {
    // Falling back to the whole document would answer with text the caller did not ask
    // for while reporting success — a wrong-scope read they have no way to detect.
    mockCall.mockResolvedValue(tabbedDoc());

    await expect(docsPatch.customHandlers!.get(
      { documentId: 'doc-2', tabId: 'nope' }, ACCOUNT))
      .rejects.toThrow(/No tab with id "nope".*t1, t2, t2a, t3/s);
  });

  it('does not serve the legacy body for an empty scoped tab', async () => {
    // `body` is the FIRST tab. Serving it because the requested tab is empty answers a
    // question about tab two with the text of tab one.
    mockCall.mockResolvedValue({
      documentId: 'doc-10',
      title: 'Two tabs',
      tabs: [
        { tabProperties: { tabId: 'a', title: 'Full' }, documentTab: { body: { content: [para('first tab text')] } } },
        { tabProperties: { tabId: 'b', title: 'Empty' }, documentTab: { body: { content: [] } } },
      ],
      body: { content: [para('first tab text')] },
    });

    const result = await docsPatch.customHandlers!.get(
      { documentId: 'doc-10', tabId: 'b' }, ACCOUNT);

    expect(result.text).not.toContain('first tab text');
    expect(result.text).toContain('the document is empty');
    expect(result.refs.characters).toBe(0);
  });
});

describe('docsPatch.get — the size cap announces itself (#158)', () => {
  /** A document of `count` tabs, each holding `chars` characters. */
  function bigDoc(count: number, chars: number): Record<string, unknown> {
    return {
      documentId: 'doc-big',
      title: 'Transcript archive',
      tabs: Array.from({ length: count }, (_, i) => ({
        tabProperties: { tabId: `t${i}`, title: `Day ${i}` },
        documentTab: { body: { content: [para('x'.repeat(chars))] } },
      })),
    };
  }

  it('hands back a tab index instead of a 200 KB wall of text', async () => {
    mockCall.mockResolvedValue(bigDoc(40, 5_000));

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-big' }, ACCOUNT);

    expect(result.text).toContain('Showing the tab index instead of the text');
    expect(result.text).toContain('Re-read with `tabId`');
    expect(result.refs.capped).toBe(true);
  });

  it('lists every tab with the id that fetches it — nothing becomes unreachable', async () => {
    // The difference between a cap and a truncation. #152 was text with no way to ask
    // for it again; this is text one call away, and the call is spelled out.
    mockCall.mockResolvedValue(bigDoc(40, 5_000));

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-big' }, ACCOUNT);

    for (let i = 0; i < 40; i++) {
      expect(result.text).toContain(`\`t${i}\` — Day ${i}`);
    }
  });

  it('a scoped read of a capped document returns that tab whole', async () => {
    mockCall.mockResolvedValue(bigDoc(40, 5_000));

    const result = await docsPatch.customHandlers!.get(
      { documentId: 'doc-big', tabId: 't7' }, ACCOUNT);

    expect(result.refs.capped).toBeUndefined();
    expect(result.refs.characters).toBe(5_000);
    expect(result.text).toContain('x'.repeat(5_000));
  });

  it('never caps a single tab — there is nothing narrower to offer', async () => {
    // Capping here would remove text with no escape hatch, which is the defect, not the
    // fix. Report the size and hand over the whole thing.
    mockCall.mockResolvedValue(bigDoc(1, 200_000));

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-big' }, ACCOUNT);

    expect(result.refs.capped).toBeUndefined();
    expect(result.refs.characters).toBe(200_000);
    expect(result.text).toContain('there is no narrower read available');
  });

  it('leaves an ordinary multi-tab document whole', async () => {
    // The measured document from #152 is ~15,000 characters. It must not trip the cap.
    mockCall.mockResolvedValue(tabbedDoc());

    const result = await docsPatch.customHandlers!.get({ documentId: 'doc-2' }, ACCOUNT);

    expect(result.refs.capped).toBeUndefined();
    expect(result.text).toContain('Standup on Monday.');
  });
});

describe('docsPatch writes — targeting a tab (#157)', () => {
  beforeEach(() => {
    mockCall.mockResolvedValue({ replies: [] });
  });

  /** The single batchUpdate request object the handler sent. */
  function sentRequest(): Record<string, unknown> {
    const [, , params] = mockCall.mock.calls[0];
    return (params as { requests: Array<Record<string, unknown>> }).requests[0];
  }

  it('write appends to the named tab', async () => {
    await docsPatch.customHandlers!.write(
      { documentId: 'doc-2', text: 'more', tabId: 't3' }, ACCOUNT);

    expect(sentRequest()).toEqual({
      insertText: { text: 'more', endOfSegmentLocation: { segmentId: '', tabId: 't3' } },
    });
  });

  it('insertText resolves the index against the named tab', async () => {
    // The whole of #157: an index measured in tab three, applied to tab three.
    await docsPatch.customHandlers!.insertText(
      { documentId: 'doc-2', text: 'more', index: 12, tabId: 't3' }, ACCOUNT);

    expect(sentRequest()).toEqual({
      insertText: { text: 'more', location: { index: 12, tabId: 't3' } },
    });
  });

  it('replaceText narrows to the named tab via tabsCriteria', async () => {
    await docsPatch.customHandlers!.replaceText(
      { documentId: 'doc-2', findText: 'a', replaceWith: 'b', tabId: 't3' }, ACCOUNT);

    expect(sentRequest()).toEqual({
      replaceAllText: {
        containsText: { text: 'a', matchCase: true },
        replaceText: 'b',
        tabsCriteria: { tabIds: ['t3'] },
      },
    });
  });

  it('sends no tabId when none was given — the request is byte-for-byte what it was', async () => {
    // Omitting the field is not the same as sending it empty: Docs treats an empty tabId
    // as an error, and tabsCriteria with no ids would narrow replaceText to nothing.
    await docsPatch.customHandlers!.insertText(
      { documentId: 'doc-2', text: 'more', index: 12 }, ACCOUNT);
    await docsPatch.customHandlers!.replaceText(
      { documentId: 'doc-2', findText: 'a', replaceWith: 'b' }, ACCOUNT);

    const [, , insert] = mockCall.mock.calls[0];
    const [, , replace] = mockCall.mock.calls[1];
    expect((insert as { requests: Array<Record<string, unknown>> }).requests[0]).toEqual({
      insertText: { text: 'more', location: { index: 12 } },
    });
    expect((replace as { requests: Array<Record<string, unknown>> }).requests[0]).toEqual({
      replaceAllText: { containsText: { text: 'a', matchCase: true }, replaceText: 'b' },
    });
  });

  it('says which tab it wrote to, or warns that it wrote to the first', async () => {
    // An untargeted write on a tabbed document succeeds and lands somewhere the caller
    // did not choose. Silence there is what made #157 invisible.
    const targeted = await docsPatch.customHandlers!.write(
      { documentId: 'doc-2', text: 'more', tabId: 't3' }, ACCOUNT);
    const untargeted = await docsPatch.customHandlers!.write(
      { documentId: 'doc-2', text: 'more' }, ACCOUNT);

    expect(targeted.text).toContain('tab `t3`');
    expect(targeted.text).not.toContain('FIRST tab');
    expect(untargeted.text).toContain('FIRST tab');
  });

  it('reports replaceText scope, which defaults to every tab', async () => {
    // replaceText is the one write that always spanned the document — tabsCriteria
    // omitted means all tabs. That default must not change under a tabId param.
    const all = await docsPatch.customHandlers!.replaceText(
      { documentId: 'doc-2', findText: 'a', replaceWith: 'b' }, ACCOUNT);

    expect(all.text).toContain('**Scope:** all tabs');
  });
});
