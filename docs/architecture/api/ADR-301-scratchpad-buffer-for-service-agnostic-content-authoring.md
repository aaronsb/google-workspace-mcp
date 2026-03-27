---
status: Draft
date: 2026-03-26
deciders:
  - aaronsb
related:
  - ADR-300
---

# ADR-301: Scratchpad Buffer — Service-Agnostic Content Authoring

## Context

The GWS MCP server currently treats every content operation as a direct API call. `manage_docs write` appends text to a live document. `manage_email send` streams the full body in a single tool call. There is no intermediate buffer — content goes straight from the LLM's output tokens to the Google API.

This creates three problems:

**1. No retry resilience.** When a send or write fails (wrong account, missing auth, bad parameter), the content is gone. The agent must recompose the entire message in a new tool call — re-streaming every token. For a 500-word email that fails because the agent picked the wrong account, that's ~700 tokens wasted and re-spent.

**2. No incremental composition.** The LLM must produce complete content in a single tool call argument. It cannot draft a section, review it, revise a paragraph, then send. This forces one-shot authoring for every content type.

**3. No content reuse across targets.** Writing the same announcement as an email to three recipients requires three full content payloads. Drafting a document and then emailing its contents requires producing the content twice.

### Reference: Confluence MCP Scratchpad (ADR-304)

The Confluence Cloud MCP server solved an analogous problem with a line-addressed scratchpad buffer. Key observations:

- Line-addressed editing reduced tool call payload size by 5-10x for typical edits
- Deferred creation eliminated unnecessary API round-trips
- Validate-on-mutate gave the LLM ambient parse health without separate validation calls

Their scratchpad is tightly coupled to Confluence: target bound at creation, content format tied to ADF serialization, buffer discarded on submit. The GWS server needs a more general primitive.

## Decision

Introduce a **scratchpad buffer** as a service-agnostic content authoring primitive, exposed as a new `manage_scratchpad` MCP tool. The scratchpad is an in-memory, line-addressed text buffer that decouples content composition from delivery.

### Core design: late-bound targets

The GWS scratchpad **binds targets at send time, not creation time.** A scratchpad starts as a content buffer with no destination. The agent composes, edits, and reviews. When content is ready, the agent sends it to any supported target — or multiple targets, or the same target with different parameters after a failure.

```
┌─────────────────────────────────────────────────────────┐
│  LLM Tool Calls (small, line-addressed or path-addressed)│
│    view, insert_lines, replace_lines, json_set, ...      │
└──────────────────┬──────────────────────────────────────┘
                   │
         ┌─────────▼──────────┐
         │  Scratchpad Buffer  │  ← lines[] + attachments + format
         │  (no target yet)    │
         └─────────┬──────────┘
                   │  send(target, params)
         ┌─────────▼──────────┐
         │  Target Adapter     │  ← resolves attachments, converts format
         │  (email│doc│ws│...) │
         └─────────┬──────────┘
                   │
         ┌─────────▼──────────┐
         │  GWS API (via gws)  │
         └────────────────────┘
```

### Scratchpad lifecycle

```
1. CREATE:    Allocate buffer (empty or pre-filled) → returns scratchpad ID
2. IMPORT:    (optional) Load content from a GWS resource into the buffer
3. ATTACH:    (optional) Reference files from workspace or Drive
4. EDIT:      Line-based or path-based mutations — no API calls
5. SEND:      Specify target + params → adapter converts + delivers
              On failure: buffer persists, agent fixes params or content, retries
              On success: buffer persists (default) or discards (keep=false)
6. DISCARD:   Explicit cleanup, or epoch-based GC
```

### Scratchpad data model

```typescript
interface Scratchpad {
  id: string;                    // sp-{random12}
  lines: string[];               // the content, line-addressed
  format: ScratchpadFormat;      // controls validation + addressing mode
  attachments: Map<string, AttachmentRef>;  // namespaced: sp-xxx/att-1
  binding?: LiveBinding;         // present when scratchpad is a live view
  label?: string;                // optional human-readable label
  lastTouchedEpoch: number;      // server-wide tool call counter at last touch
  createdAt: Date;
}

type ScratchpadFormat = 'text' | 'markdown' | 'json' | 'csv';

// Present when scratchpad is bound to a live GWS resource (JSON mode)
interface LiveBinding {
  service: 'docs' | 'sheets';
  resourceId: string;            // documentId or spreadsheetId
  account: string;               // email for API calls
}

interface AttachmentRef {
  refId: string;           // "att-1", "att-2" — scoped to scratchpad ID
  source: 'workspace' | 'drive' | 'import';
  filename: string;
  mimeType: string;
  size: number;
  location: string;        // workspace file path or Drive fileId
}
```

**Format** defaults to `text` on `create`. Import operations set it based on the source (doc markdown export → `markdown`, doc JSON → `json`, sheet → `csv`). The format controls which validator runs on mutation and whether path-addressed operations are available.

**Attachments** are a side-table mapping reference IDs to file metadata. The combination of scratchpad ID + attachment ID (`sp-abc123/att-1`) is globally unique — no complex naming needed. In the buffer, attachments appear as reference markers:

```markdown
![quarterly chart](att:att-1 "chart.png, 45 KB, from workspace")
```

The agent can move, copy, or remove marker lines using normal line operations. The side-table is the source of truth for what's attached; markers are for visibility and positioning.

### MCP tool: `manage_scratchpad`

Follows the operation-based pattern from ADR-300.

**Buffer operations:**

| Operation | Parameters | Effect |
|-----------|-----------|--------|
| `create` | `label?`, `content?`, `format?` | Allocate buffer. Returns scratchpad ID. |
| `view` | `scratchpadId`, `startLine?`, `endLine?` | Show content with line numbers + validation status. |
| `insert_lines` | `scratchpadId`, `afterLine`, `content` | Insert text after line N (0 = prepend). |
| `append_lines` | `scratchpadId`, `content` | Append text at end. |
| `replace_lines` | `scratchpadId`, `startLine`, `endLine`, `content` | Replace line range. |
| `remove_lines` | `scratchpadId`, `startLine`, `endLine?` | Remove line(s). |
| `copy_lines` | `scratchpadId`, `fromScratchpadId`, `startLine`, `endLine`, `afterLine` | Copy lines from another scratchpad (source unmodified). |
| `discard` | `scratchpadId` | Free the buffer and attachments. |
| `list` | — | List active scratchpads with line counts and attachment counts. |

**JSON path operations** (only when format is `json`):

| Operation | Parameters | Effect |
|---|---|---|
| `json_get` | `scratchpadId`, `path` | Read value at JSON path. Returns value + line span. |
| `json_set` | `scratchpadId`, `path`, `value` | Set value at path. If live-bound: fires API mutation + reloads buffer. If unbound: local mutation + re-serialize. |
| `json_delete` | `scratchpadId`, `path` | Remove key or array element. Same live/local behavior as `json_set`. |
| `json_insert` | `scratchpadId`, `path`, `value` | Push value into array. Same live/local behavior as `json_set`. |

Path syntax: JSONPath-like dot/bracket notation (`$.body.content[0].paragraph.elements[0].textRun.content`). Line operations remain available — the agent can mix both addressing modes.

**Live-bound JSON scratchpads.** When a JSON scratchpad has a `LiveBinding` (set during `import` from a doc or sheet in JSON mode), every `json_set`/`json_delete`/`json_insert` mutation does three things:

1. Translates the path operation to the appropriate API call (`batchUpdate` for Docs, `values.update` for Sheets)
2. Fires the API call immediately
3. Reloads the full resource JSON into the buffer

This means the buffer always reflects the live state of the document. There is no divergence, no deferred send, no merge conflicts. Each mutation is atomic — if the API call fails, the buffer reloads to the last good state and the error is returned with context.

```
json_set(sp, "$.body.content[2]...textRun.content", "New heading")
  → batchUpdate: replaceText at computed index range
  → API call fires
  → reload: documents.get → re-parse into buffer
  → return: "Set $.body.content[2]...textRun.content. Buffer: 847 lines.\nStatus: valid"
```

This model is more API calls than deferred send, but each call is small and the reload prevents impossible-to-debug ordering collisions. The trade-off is deliberate: correctness over efficiency for structured document editing.

**Unbound JSON scratchpads** (created with `format: json` but no import from a live resource) work like text mode — mutations are local, and `send` delivers the buffer. This covers composing JSON payloads, config files, or structured data that doesn't back a live resource.

**Import and attachment operations:**

| Operation | Parameters | Effect |
|---|---|---|
| `import` | `scratchpadId`, `source`, `sourceParams` | Load content from a GWS resource. Sets format. |
| `attach` | `scratchpadId`, `source` (`workspace`\|`drive`), `filename` or `fileId`, `afterLine?` | Add file to side-table, insert reference marker. |
| `detach` | `scratchpadId`, `refId` | Remove from side-table. Marker line left for agent to remove. |

**Delivery operations:**

| Operation | Parameters | Effect |
|---|---|---|
| `send` | `scratchpadId`, `target`, `targetParams`, `keep?` | Deliver to a GWS target. `keep` defaults to `true`. |

### Line operations

Identical semantics to the proven Confluence scratchpad pattern:

- **Line numbers are 1-based** — matches `view` display and editor conventions.
- **Content parameter accepts multi-line text** — split on `\n`, CRLF/CR normalized.
- **Mutation responses include context markers** — the edit site plus one line of surrounding context, not the full buffer.
- **Validation status appended** — every mutation response ends with a format-specific status line.

### Epoch-based garbage collection

Time-based timeouts are wrong for a multi-service MCP server where the agent may do calendar, email, and drive operations between edits. Instead, use an **epoch counter**: a server-wide integer that increments on every tool call.

The counter lives at the `handleToolCall` dispatch layer — the single entry point for all tool calls. For `queue_operations`, each batched operation also increments the counter.

```typescript
let epoch = 0;

export function advanceEpoch(): number { return ++epoch; }
export function getEpoch(): number { return epoch; }
```

Each scratchpad records `lastTouchedEpoch`. Any scratchpad operation resets it.

```
GC rule: if (currentEpoch - sp.lastTouchedEpoch > 100) → collect
```

The threshold of 100 reflects the asymmetry of failure modes: premature collection loses composed content (expensive), while late collection holds a few KB in memory longer than needed (free). GC runs lazily at the start of any `manage_scratchpad` call.

### Import: loading from GWS resources

The `import` operation loads content from a GWS resource into the buffer. It sets the scratchpad format and, for docs, offers two modes.

| Source | Mode | What gets loaded |
|--------|------|-----------------|
| `doc` | `markdown` (default) | Markdown export via `gws docs export --mime text/markdown`. Headings, lists, bold/italic, tables, links preserved as markdown. Sets format to `markdown`. |
| `doc` | `json` | Native Docs API JSON via `documents.get`. Full rich structure preserved. Sets format to `json`. Enables round-trip via `doc_update`. |
| `email` | — | Email body as plain text. Email attachments optionally registered in the side-table. |
| `sheet` | — | Sheet data as CSV lines. Sets format to `csv`. |
| `drive_file` | — | Text content of a Drive file. |

Import appends to the existing buffer (does not replace). Multiple imports can compose into one scratchpad.

**Markdown mode** is for rewriting, extracting text, and cross-service delivery. It's lossy — rich formatting markdown can't represent is dropped. But embedded images survive: binary content (base64 data URIs in the export) is extracted to the workspace directory and registered in the attachment side-table. The buffer gets a reference marker, not a blob.

**JSON mode** is for targeted edits to rich documents where formatting must be preserved. The agent uses `json_set`/`json_get` to modify specific fields. Mutations apply live to the API — the buffer reloads after each change, always reflecting the real document state. From the agent's perspective, it's just editing a JSON scratchpad.

### Send: delivering to GWS targets

| Target | `targetParams` | What happens |
|--------|----------------|--------------|
| `email` | `email`, `to`, `subject`, `cc?`, `bcc?` | Content becomes email body. Attachments become file attachments. |
| `email_draft` | `email`, `to?`, `subject?` | Content becomes draft body. |
| `doc_create` | `email`, `title` | New document from content. Attachments uploaded as inline images. |
| `doc_write` | `email`, `documentId` | Content appended to existing document. |
| `workspace` | `filename` | Writes content to workspace file. Attachments copied alongside. |

**No `doc_replace` for text/markdown.** Overwriting a rich doc with flat text destroys formatting. For new content: `doc_create`. For appending: `doc_write`. For in-place edits preserving formatting: import in JSON mode — mutations apply live, no explicit send needed.

The `keep` parameter (default: `true`) controls whether the scratchpad survives after send:

- **Retry on failure**: send fails → fix params → send again (content never lost)
- **Multi-recipient email**: send to alice → send to bob → discard
- **Cross-service delivery**: send as email → also create as doc → discard
- **One-shot cleanup**: `keep: false` for fire-and-forget

The `workspace` target enables a rewrite workflow: import a document, edit in the scratchpad, write as `.md` with the same root name. The human gets markdown alongside the original and owns the formatting merge.

### Validation (format-driven)

Every mutation appends a format-specific status line. Validation is **informational, not blocking**.

| Format | Checks | Error example |
|---|---|---|
| `text` | None — always valid | `Status: valid (N lines)` |
| `markdown` | Unclosed code fences | `Status: invalid at line 12 — unclosed code fence` |
| `json` | `JSON.parse()` with line/column extraction | `Status: invalid at line 8:3 — Expected ','` |
| `csv` | Column count consistency, unmatched quotes | `Status: invalid at line 5 — expected 4 columns, got 3` |

### Error-trap-and-fix on send

When `send` fails due to a content problem, the error response includes **line-level attribution** when the adapter can map the error to a source line:

```
Send failed (target: sheet): Invalid character U+0000 in cell data.
  Content line 14 → Sheet row 12, column C
  14 | Revenue Q3,450000,\x00bad-data
Scratchpad sp-abc123 is still active (42 lines).
```

This creates a tight fix loop: `send → error at line 14 → replace_lines 14 → send → success`. The buffer always survives failed sends.

### Cross-scratchpad assembly

The `copy_lines` operation enables assembly: load multiple sources, cherry-pick sections into a combined buffer, deliver the result.

```
import(sp-A, source: doc, docId: report)      → Q3 report
import(sp-B, source: email, messageId: notes)  → meeting notes
create(sp-C, label: "combined briefing")        → empty

copy_lines(sp-C, from: sp-A, lines: 1-15, afterLine: 0)
append_lines(sp-C, "\n---\n\n## Discussion Notes\n")
copy_lines(sp-C, from: sp-B, lines: 8-30, afterLine: 20)

send(sp-C, target: email, to: execs@co.com, subject: "Q3 Briefing")
send(sp-C, target: doc_create, title: "Q3 Briefing")
```

`copy_lines` reads from the source without modifying it. This composes naturally with `queue_operations` for batch assembly and delivery.

### Integration with queue_operations

Scratchpad operations are regular tool calls that work with the queue:

```json
{
  "tool": "queue_operations",
  "operations": [
    { "tool": "manage_scratchpad", "operation": "send",
      "scratchpadId": "sp-abc123", "target": "email",
      "targetParams": { "email": "me@co.com", "to": "team-a@co.com", "subject": "Update" }},
    { "tool": "manage_scratchpad", "operation": "send",
      "scratchpadId": "sp-abc123", "target": "email",
      "targetParams": { "email": "me@co.com", "to": "team-b@co.com", "subject": "Update" }},
    { "tool": "manage_scratchpad", "operation": "discard",
      "scratchpadId": "sp-abc123" }
  ]
}
```

The `$N.field` result-reference syntax works across scratchpad operations.

### Implementation approach

The scratchpad is a **hand-written handler** (like `manage_accounts` and `manage_workspace`), not a factory-generated tool:

- In-memory state (buffer map + epoch) doesn't fit the stateless factory pattern.
- Operations don't map to `gws` CLI calls — they're local mutations with `send`/`import` as the API touchpoints.
- The tool schema is custom, not derivable from the gws CLI manifest.

### Tool instruction changes

The scratchpad only works if the agent reaches for it. Tool descriptions must **promote scratchpad-first authoring** for multi-line content, keeping direct operations for simple one-shot cases.

**Route by content complexity, not service type:**

| Scenario | Route |
|---|---|
| Quick reply ("Sounds good, thanks.") | Direct `manage_email send` |
| Multi-paragraph email | Scratchpad → `send` to email |
| Single line append to a doc | Direct `manage_docs write` |
| Writing or rewriting sections | Scratchpad → `send` to doc |
| Cross-service content (email → doc) | Scratchpad `import` → edit → `send` |
| Batch document rewrites | Scratchpad `import` → edit → `send` to workspace |

Tool descriptions and next-steps guidance updated to reference scratchpad workflows at natural discovery points (after reading an email, after a failed send, after reading a doc).

## Consequences

### Positive

- **Token efficient**: Line-level edits send changed text only. A typo fix is ~20 tokens, not ~700 for a re-streamed email body.
- **Retry resilient**: Failed sends preserve content. Fix parameters or content and retry without recomposing.
- **Composable**: Same content targets email, docs, workspace, multiple recipients. Compose once, deliver many.
- **Dual addressing**: Line operations for prose, JSON path operations for structured data. Mix freely.
- **Attachments without blobs**: Files referenced by ID, resolved at send time. No base64 in the buffer.
- **Round-trip for rich docs**: Live-bound JSON mode applies mutations directly to the API — no deferred send, no merge conflicts, always consistent.
- **Queue-compatible**: Composes with `queue_operations` for batch assembly and delivery.
- **Activity-based lifecycle**: Epoch GC ties buffer lifetime to server activity, not wall clock.

### Negative

- **Memory consumption**: Each scratchpad holds content in memory. Typical use (a few buffers of a few hundred lines) is negligible. Pathological use would need a cap.
- **No persistence**: Scratchpads are lost on server restart. Intentional — they are session artifacts. The agent can re-import.
- **Import complexity**: Doc markdown export may need image extraction; JSON import loads the full Docs API structure. Both are new code.
- **Adapter surface**: Each send target needs an adapter. Initial scope: email, email_draft, doc_create, doc_write, doc_update, workspace.

### Neutral

- The scratchpad is additive — existing tools unchanged. `manage_docs write` and `manage_email send` still work for one-shot use.
- The workspace handler remains for file I/O. The scratchpad is for content that will be delivered or exported, not raw file storage.
- The hand-written handler pattern is established (`manage_accounts`, `manage_workspace`).

## Alternatives Considered

### Port the Confluence scratchpad directly

Bind target at creation, discard on submit, time-based timeout. Misses the key GWS scenarios: retry with different parameters, multi-recipient delivery, cross-service reuse, attachment handling. The Confluence model is a starting point, not the destination.

### Add drafting to each service tool

`manage_email` gets a `draft` operation, `manage_docs` gets a `buffer` mode. This distributes the problem: the agent learns different drafting APIs per service, content can't move between services, every handler grows a mini buffer system. A single scratchpad is simpler and more composable.

### Use the workspace (filesystem) as the buffer

Write drafts to files, edit via workspace `read`/`write`. Awkward: full-file replacement (not line-addressed), no validation, no lifecycle management, no attachment tracking. The scratchpad provides what the filesystem lacks.

### Validate strictly (block on invalid content)

Reject mutations that produce invalid state. Prevents the LLM from working through intermediate invalid states — scaffolding, out-of-order composition, paste-then-refine. Informational validation is better: report status, don't block.
