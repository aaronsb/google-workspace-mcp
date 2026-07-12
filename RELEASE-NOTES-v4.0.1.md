# v4.0.1

Bug fixes. Every one of these was found by *running* the tools against a real account rather than by reading the code, and **not one of them raised an error** — each reported success while doing the wrong thing.

## Mail

**Thread listings had no senders and no subjects.** `manage_email getThread` rendered every message in a thread like this:

```
**** —
Add full device config for QC Earbuds…
```

Gmail's `metadataHeaders` is a *repeated* query parameter — it must be sent once per value (`?metadataHeaders=From&metadataHeaders=Subject`). It was being sent as a single comma-joined string, so Google looked for the one header literally named `"From,Subject,Date,To"`, found nothing, and returned a payload with **no headers at all**. The formatter was correct the whole time; it was being handed an empty response. The API descriptor already records which parameters are repeated, so the client now consults it.

**Rate-limited reads rendered as blank rows.** A message that could not be fetched came back as a row with no sender, no subject, and no date — indistinguishable from an empty email:

```
19f5129863afedf6 |  | (no subject) |
```

Every failure was silently swallowed. A message we could not *read* now says so (`⚠ could not load (429 rateLimitExceeded)`) instead of pretending to be blank.

**The client now retries throttled requests.** It previously had no retry at all. Google throttles per *user*, not per process, so two clients signed in to the same account — a desktop app and an editor, say — share one quota, and a burst of perfectly valid reads can be refused. 429 and 5xx are now retried with exponential backoff and jitter, honouring `Retry-After`. Client errors (404 and friends) are not retried. Search hydration is also bounded to 8 concurrent reads instead of firing the whole page at once.

**Snippets were HTML-escaped.** Previews containing an apostrophe read as `codename &#39;lando&#39;`. Now decoded.

## Session context

**The unread and "today" counts were not counts.** They read `resultSizeEstimate`, which is an estimate in name and in fact: on a real mailbox it returned the same number — **201** — for `is:unread` (truly 135,824) and for mail received today (truly 30). Not an approximation; a constant, unrelated to the question.

Both numbers were wrong, and *identically* wrong, which also made the delta impossible: the session baseline and the current reading came from the same constant, so they always agreed. **"No new unread emails since session start" was the only sentence that line could ever produce.** It never worked.

Unread now comes from the INBOX label, which Gmail maintains exactly. Today's mail is counted.

## Tasks

**`update` failed on every call.** It exposed no updatable fields, so the only request it could build was a `PATCH` with an empty body — which Google Tasks answers with a `500 Internal error encountered`, an error that reads like an outage on Google's side and was not. This operation has never worked. It now takes `title`, `notes`, `due` and `status`, applies proper patch semantics (fields you don't pass are left alone), and an update naming no field is refused locally with a message saying which fields it takes.

**`create` made blank, titleless tasks** and **`createTaskList` made nameless lists** — `title` was not in the tool's schema, so passing one dropped it in silence. Both now take the fields you would expect.

## Docs

**`get` returned no document text**, despite being described as "get document content and metadata". Google nests a document's text several levels down and puts nothing readable at the top level, so every document came back looking empty. It now returns the text, including the contents of tables.

**`create` could only produce "Untitled document"** — it now takes a `title`.

## Drive

**A file in the workspace could not be uploaded by its own name.** A relative path resolved against the server's working directory — wherever your MCP client happened to launch it — while `download`, `export` and email attachments all treat a relative path as workspace-relative. Relative paths are now workspace-relative everywhere; absolute paths are unchanged.

## Everywhere

**Create operations now say what they created.** The generic confirmation only recognised an identifier named exactly `id`; Google calls it `documentId` in Docs and `spreadsheetId` in Sheets, so creating a document returned, in full: `Operation completed.` It now names the identifier and the title.

## For contributors

`make check` gained a guard asserting that every write operation is *capable* of carrying a request body — an operation cannot again ship structurally unable to do its job.

The coverage baseline had inverted logic: it inferred coverage from the presence of *parameter gaps*, so an operation with every parameter mapped had no gaps, and was recorded as **uncovered because it was perfectly covered**. Twenty-five already-implemented operations sat in `coverage-baseline.json` as work for contributors to pick up. Fixed, and the generator now refuses to write a baseline that contradicts its own report.

New: **[the full API surface](docs/api-surface.md)** — all 233 methods Google publishes across the seven APIs, what each does (in Google's own words), whether it is exposed, and a one-click link to request one that isn't.
