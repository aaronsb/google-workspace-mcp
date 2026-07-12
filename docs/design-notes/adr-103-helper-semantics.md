# gws helper semantics — what we actually have to rebuild

Read from the gws Rust source (`github.com/googleworkspace/cli` @ `a3768d0`, frozen main, `Cargo.toml version = 0.22.5` — an exact match for the installed binary), and confirmed against `gws <svc> --help`. ADR-103, verification item 9.

## Two corrections to ADR-103

**1. There are 11 helpers, not 13 — and not 10.**

`drive +download` and `docs +export` **do not exist and never have.** gws registers exactly:

| service | helpers |
|---|---|
| gmail | `+send` `+triage` `+reply` `+reply-all` `+forward` `+read` `+watch` |
| calendar | `+insert` `+agenda` |
| drive | `+upload` **only** |
| docs | `+write` **only** |
| sheets | `+read` `+append` |

Two of our call sites invoke the nonexistent ones and have **always** failed (exit 3). See "The bug this uncovered", below.

**2. Only TWO helpers reshape Google's response.**

This is the important one, and it shrinks the job dramatically. `+triage` and `+agenda` hand-roll HTTP with `reqwest` and print a **synthesised** object. **Every other helper** builds params and calls `executor::execute_method(...)`, which prints **Google's raw response verbatim**.

So `+send`, `+reply`, `+reply-all`, `+forward`, `+insert`, `+upload`, `+write`, `+read`, `+append` **already emit raw Google JSON**. There is no gws opinion in them to discard — only *behaviour* (MIME assembly, threading, recipient logic) to reproduce.

The surface where "gws's opinion" actually lives is **two helpers**. ADR-103's framing — "the 10 helpers are CLI-audience interpretation we deliberately discard" — overstated it.

---

## The two that reshape

### `+triage` → we already own the replacement

- **Calls**: `users.messages.list?q=…&maxResults=…` → then `users.messages.get?format=metadata&metadataHeaders=From&Subject&Date` per id, concurrently (`buffer_unordered(10)`).
- **Defaults**: `--max 20`, `--query "is:unread"`.
- **Emits**: `{ messages: [{id, from, subject, date}], resultSizeEstimate, query }` — missing headers become `""`, not null.
- **Silently drops** individual message GETs that fail. The count can be short with no error.

**We already have this.** `gmailPatch.afterExecute.search` → `hydrateMessages()` (`src/services/gmail/patch.ts:23`) does exactly this walk over `payload.headers`, and returns a **superset** (`threadId` and `snippet` too). `+triage` becomes `users.messages.list` with `q: 'is:unread'` plus the hydrate we own. **No new code.**

### `+agenda` → the one real merge

- **Calls**: `calendarList.list` → for each calendar concurrently (`buffer_unordered(5)`): `events.list?timeMin&timeMax&singleEvents=true&orderBy=startTime&maxResults=50`. Flattened, then **re-sorted client-side** by string compare on `start`.
- **Emits**: `{ events: [{start, end, summary, calendar, location}], count, timeMin, timeMax }`.
  - `start`/`end` = `start.dateTime` falling back to `start.date`.
  - `summary` defaults to the literal `"(No title)"`; `location` to `""`.
  - `calendar` is the calendar's **display name**, falling back to its id.
- **Day ranges** — note `--week` is *not* a calendar week:
  - `--today` → `[start_of_today, +1d]`
  - `--tomorrow` → `[start_of_today +1d, +2d]`
  - `--week` → `days = 7`, so `[now, now + 7d]` — a **rolling window from the current instant**
  - `--days N` → `[now, now + N d]`
  - default → `[now, now + 1d]`
- **Timezone**: day boundaries are computed in the **Google account's** timezone (from the Calendar Settings API), not the machine's.
- **Known defects we should not reproduce**: per-calendar failures are **silently swallowed** (a broken calendar contributes zero events, no error); `maxResults=50` per calendar with **no pagination** (events beyond 50 in one calendar are simply lost).
- **Output format**: `+triage`/`+agenda` default to a **TABLE**, not JSON — `.unwrap_or(OutputFormat::Table)`. (Our executor always passes `--format json`, so we get JSON. This is why three call sites defend with `typeof result.data === 'string'`.)

---

## The behaviour that must be reproduced (not the shape)

### `+send`
- **MIME**: built with `mail_builder`. `--html` → html body, else text. Attachments → `multipart/mixed`; Content-Type per attachment guessed from the **file extension**, falling back to `application/octet-stream`.
- **Upload**: **always `uploadType=multipart`**, wrapping the RFC-5322 message as the media part. **No resumable path, no size threshold** — one code path at any size.
- **Cap**: client-side `MAX_TOTAL_ATTACHMENT_BYTES = 25 MiB` of *raw* attachment bytes (the API limit is 35 MB post-base64).
- Rejects: control chars in paths, non-regular files, **0-byte files**, >25 MB total.
- **Sender resolution**: `sendAs.list` → pick `isDefault`, or enrich a bare `--from` with its send-as display name. Falls back to the People API for a display name. All failures degrade gracefully.

> Note: our own item-4 work already proved the **resumable** path works and round-trips 25 MB byte-for-byte. We are not obliged to copy gws's multipart-only approach, and resumable is the better choice.

### `+reply` / `+reply-all`
- **Calls**: `messages.get?format=full` → `sendAs.list` → (`users.getProfile` for reply-all) → `messages.send` with metadata `{threadId}`.
- **Subject**: `Re: ` prefix unless already starts with `re:` (lowercased — so `RE:` matches, `Aw:` does not).
- **Threading**: `In-Reply-To` = original `Message-ID`; `References` = original `References` chain **plus** the original `Message-ID`. Also sends `threadId`.
- **`+reply` recipients**: `To` = original `Reply-To` if present, **else** original `From`. Cc = only what you pass.
- **`+reply-all` recipients** — the subtle part:
  - Excludes `--remove`, **the authenticated user's primary email** (`users.getProfile`), **and** the `--from` alias (they can differ). **Yes, it dedupes you.**
  - **Self-reply special case**: if the original `From` is you (primary *or* alias), then `To` = original **To** and `Cc` = original **Cc**, and `Reply-To` is ignored — matching Gmail web on self-sent mail.
  - Otherwise `To` = `Reply-To`/`From`, and **`Cc` = original `To` + original `Cc`**.
  - Final `dedup_recipients` enforces priority **To > Cc > Bcc** (an address in two fields survives only in the highest).
  - **Errors** if `To` ends up empty after exclusions.
- **Quoting**: plain → `On {Date}, {From} wrote:` with `> ` line prefixes. HTML → Gmail-web-identical `gmail_quote gmail_quote_container` blockquote.
- **Attachments**: original attachments are **NOT** re-attached on reply. Inline images (parts with a Content-ID) are re-fetched **only in `--html` mode**, into a `multipart/related` container (because Gmail rewrites `inline` → `attachment` inside `multipart/mixed`).

### `+forward`
- **`Fwd: ` prefix** unless already `fwd:`.
- **Stays in the same thread** — it sets `In-Reply-To`, `References` *and* `threadId`. Unusual; make this a conscious decision rather than an inherited accident.
- **Re-attaches the originals**: `messages.attachments.get` per part, base64url-decoded and rebuilt. Regular attachments included unless `--no-original-attachments`; inline images included only in `--html` mode (and `--no-original-attachments` does not remove them — they are body, not attachments).
- Size preflight against the 25 MB cap using `body.size` metadata *before* downloading.
- Forwarded block: `---------- Forwarded message ---------` then `From:/Date:/Subject:/To:/Cc:`.

### `+insert` (calendar)
- `events.insert` with `{summary, start:{dateTime}, end:{dateTime}}` + optional location/description/attendees.
- **Only ever emits `dateTime`** — no `timeZone`, no `date`. **All-day events are not expressible.** A limitation, not a feature.
- **`--meet`**: sets `conferenceData.createRequest.conferenceSolutionKey.type = "hangoutsMeet"` and `params.conferenceDataVersion = 1`. The `requestId` is **not random** — it is a **UUIDv5** over a canonical payload (`{v, summary, start, end, location?, description?, attendees sorted}`), making it an **idempotency key**: re-running the same `+insert --meet` reuses it. Worth keeping.

### `+upload` (drive)
- `files.create`, **always `uploadType=multipart`**, never resumable, no chunking, at any size.
- Metadata `{name}` + `{parents:[parent]}`. MIME from extension.

### `+write` (docs)
- `documents.batchUpdate` with a single `insertText` at `endOfSegmentLocation: {segmentId: ""}` — i.e. **append to end of body only**. No index targeting, no formatting.

### `+read` / `+append` (sheets)
- `+read` → `spreadsheets.values.get` with `{spreadsheetId, range}` and **nothing else** — so Google's defaults apply (`majorDimension=ROWS`, `FORMATTED_VALUE`). `--range` required.
- `+append` → `spreadsheets.values.append` with `valueInputOption: "USER_ENTERED"`, `--range` defaulting to the literal `"A1"`.
- **A defect not to copy**: `--values` splits on `,` with **no quoting or escaping**, so a comma inside a cell is impossible. And unparseable `--json-values` produces a stderr warning and sends `values: []` rather than erroring.

---

## The bug this uncovered

`drive +download` and `docs +export` never existed, yet:

- `src/server/scratchpad/adapters/import-doc.ts:47` → `execute(['docs','+export','--document',id,'--mime','text/markdown'])`
- `src/server/scratchpad/adapters/import-drive.ts:51` → `execute(['drive','+download','--file-id',fileId])`

Both exit **3** ("unrecognized subcommand"). Reproduced end-to-end against the shipped v3.0.0 server:

```
manage_scratchpad import source=doc
-> Import failed: error: unrecognized subcommand '+export'
```

**This is not dependency rot.** `import-doc.ts` landed in #78 when `package.json` pinned `@googleworkspace/cli: ^0.13.2`, and **0.13.2 registers the same two helpers only** (verified by installing it). The feature has been broken since the commit that introduced it, and has shipped broken in every release since.

**Why nothing caught it:** the tests mock `execute()`. The mock returns success for a command the real binary has always rejected. No test and no CI job ever asked the binary whether the subcommand existed — a check reporting success while measuring the wrong thing, which is the defect class this repo keeps re-learning. There is also **no test at all** referencing either adapter.

**Both map onto real Google methods** and are fixed by the migration: doc export → `drive files.export` (`mimeType=text/markdown`); drive download → `drive files.get` + `alt=media`, streamed.

**Prevention, which matters more than the fix:** the descriptor knows every method Google has. Emit a **TypeScript union of valid resource paths per service** so that

```ts
call('docs', 'documents.export', …)   // no such method
```

is a **compile error**. That makes this entire bug class unrepresentable, and it is nearly free — the names are already in `descriptor.json`.
