---
status: Accepted
date: 2026-08-16
deciders:
  - aaronsb
related:
  - ADR-301
  - ADR-103
---

# ADR-306: Tab-addressed Docs reads and writes

## Context

A Google Doc is not one body of text. Since tabs shipped, a document is a tree of tabs, each carrying its own `body` and — the part that matters here — **its own character index space**. Google's API keeps a legacy `body` field at the root for compatibility, and it holds the first tab only.

Three defects fell out of that, all filed within a day of each other:

- **#152** — `manage_docs get` read the legacy `body` and presented the first tab as the whole document. A 780-line document returned 142 lines with no error. Fixed in v4.1.0 by setting `includeTabsContent`, which moves content to `tabs[].documentTab.body` and removes `body`, `headers`, `lists`, `inlineObjects` and `namedStyles` from the response.
- **#157** — `write` and `insertText` never sent a `tabId`. Google documents the default for both `Location` and `EndOfSegmentLocation`: *"If omitted, the request applies to the first tab in the document."* Before #152 that was invisible but coherent — reads returned tab one, writes hit tab one, one index space. After #152 the read spans every tab and the write still lands in the first, so an index computed from a `get` response means nothing to the `insertText` that consumes it. (`replaceText` was never affected: `ReplaceAllTextRequest` with `tabsCriteria` omitted applies across all tabs.)
- **#155** — `manage_scratchpad` json-mode import called `documents.get` without the flag, so it imported the first tab and called it the document. The flag was left off deliberately: the buffer is live-bound for round-trip editing (ADR-301, issue #79) and `docs-sync` translates mutations against `$.body.content[…]` paths, which the flag removes. Setting it would have traded a multi-tab import for a scratchpad that could no longer write anything back.

Underneath all three is one gap: **the API surface had no way to name a tab**. `get` exposed `documentId` and nothing else, so an agent reading `**Tabs:** 40` had no handle to narrow with, and the writes had no handle to target with. #152's fix made reads correct and left them unbounded — a 40-tab transcript archive is a single ~200 KB tool response.

This is the recurring defect shape ADR-103 predicted for a hand-built API surface: wherever Google's raw shape is nested, the reshaping is ours, and a read that under-reports with no error is indistinguishable from a document that really is short.

## Decision

**`tabProperties.tabId` is the addressing primitive for Docs, on both sides of the surface.** The same handle scopes a read and targets a write, so an index measured in one is meaningful to the other.

### Read side

- `get` returns a `tabIndex` in `refs` — `{tabId, title, depth, characters}` per tab, nested tabs included. This replaces the flat `tabTitles` array, which carried half the information and none of the addressing.
- `get` takes an optional `tabId` that scopes the read to one tab. A scoped read takes **no** fallback to the legacy `body`: serving the first tab because the requested tab is empty answers a question about one tab with the text of another.
- An unmatched `tabId` throws and lists the real ones. Falling back to the whole document would return text the caller did not ask for while reporting success.
- Over ~25,000 estimated tokens, a multi-tab read returns the **tab index** instead of the text, naming the id that fetches each tab. This is a cap with an escape hatch, not a truncation: no text becomes unreachable, it becomes reachable one tab at a time. A single tab is never capped — there is nothing narrower to offer, and removing text with no way to ask for it again is #152, not a fix for it.

### Write side

- `write` → `endOfSegmentLocation.tabId`; `insertText` → `location.tabId`; `replaceText` → `replaceAllText.tabsCriteria.tabIds`.
- All three are **optional**, and omitting one sends no field at all. Existing single-tab callers are byte-for-byte unchanged, and `replaceText` keeps spanning the document by default.
- A write with no `tabId` says in its response that it acted on the first tab. The write still succeeds — Google's default is legitimate for the single-tab documents that are most of them — but silence about it is what made #157 invisible.

### Scratchpad JSON mode

- Both `documents.get` call sites — `importDocJson` and `reloadDocsBuffer` — set `includeTabsContent`. They move together or a buffer and its post-sync reload disagree about the shape of the document, and paths that translated before a push stop resolving after it.
- `docs-sync` addresses `$.tabs[T].documentTab.body.…` and carries the tab's `tabId` onto every `Location` and `Range` it emits.
- The tab prefix is matched **generically** — split the path at `body.content` and require the preceding segment to be `documentTab` — rather than as a fixed shape. Tabs are a tree, so `tabs[T].childTabs[C].documentTab.body.…` is an ordinary path, not an edge case.
- A path whose tab has no resolvable `tabId` is **rejected**. A missing id is not a missing option; it is a write to the wrong tab that reports success.
- The bare `$.body.…` shape still translates, without a tabId, for the response that carries no tabs at all.

Scratchpad buffers are in-memory, so the buffer-shape change needs no migration: no buffer outlives the process that imported it. Agents derive paths from the buffer they just read rather than hardcoding them, so the shape is self-describing at the point of use.

## Consequences

### Positive

- Read and write share one coordinate system. "Read this tab, then edit it" is expressible for the first time.
- The unbounded response from #152's fix is bounded without reintroducing silent truncation — every cap and every scoping decision states itself in the response text.
- JSON-mode scratchpads see whole documents and can still write back, which #155 framed as the thing the obvious one-line change would have traded away.
- Nested tabs are addressable everywhere, on all three surfaces, rather than working on the read side and failing on the write side.

### Negative

- Four operations gained a parameter. The manifest descriptions carry the "omit and it means the FIRST tab" warning, which is more tool-schema prose for the model to hold.
- Reading a large multi-tab document is now N+1 calls: one for the index, one per tab wanted. That is the point of the cap, but it is more round-trips for a workflow that genuinely wants everything.
- `refs.tabTitles` is gone, replaced by `refs.tabIndex`. Refs are consumed by a model rather than compiled against, so this is a re-read rather than a break — but it is a visible response change.

### Neutral

- No override exists to force the full text of a capped document. Per-tab reads reach every byte, so nothing is unreachable; if a workflow proves the round-trips are the wrong trade, that is a new parameter and a new issue, not a silent default.
- The `$.body.…` path shape is retained in `docs-sync` for the tabless response. Nothing this codebase requests produces that shape today; it is defensive, and cheap.

## Alternatives Considered

- **Detect and refuse for #155** — keep the flagless fetch, count tabs, and tell the caller json mode covers the first tab only, pointing at markdown mode for the whole document. The smallest honest fix, and it stops the silent truncation. Rejected because it leaves multi-tab json import unsupported: the bug shrinks to a message rather than closing, and the read/write asymmetry stays.
- **Import all tabs, bind only one** — full fidelity on read, writes scoped to a chosen tab. Rejected because it needs a way to say which tab, which is most of the tab-addressing plumbing anyway — and it leaves the buffer describing content the sync layer refuses to address.
- **Truncating the concatenated text at the cap** — matches the Gmail `chooseBodyContent` precedent most literally. Rejected because Gmail's truncation has an escape hatch (`fullBody: true` re-reads the same message) and a mid-document cut does not: the tail would be gone with no way to name it. Returning the tab index preserves the precedent's real rule — a cap that announces itself and says how to get the rest.
- **Per-endpoint tab plumbing without a read-side index** — fix #157 alone. Rejected as unusable: `tabId` is only obtainable from a read, so shipping the write parameter without exposing tab ids would add a parameter no caller could fill.
