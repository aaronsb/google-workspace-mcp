---
status: Draft
date: 2026-04-08
deciders:
  - aaronsb
related:
  - ADR-301
  - ADR-300
---

# ADR-302: Scratchpad HTML Format and Format-Aware Validation

## Context

The scratchpad buffer (ADR-301) currently supports four formats: `text`, `markdown`, `json`, and `csv`. Each has a basic validator that runs on every mutation — unclosed code fences for markdown, parse errors for JSON, column count for CSV. These validators are minimal: hand-written, ~20 lines each, catching only structural errors.

Two problems are emerging:

### 1. HTML is a missing first-class format

HTML is the lingua franca of Google Workspace content:

- **Gmail**: Message bodies are HTML. The plain-text part is often a lossy stub — marketing emails, booking confirmations, and rich notifications put meaningful content (dates, tracking numbers, confirmation codes) exclusively in HTML. The current email import strips HTML to plain text, losing this information.
- **Google Docs**: The Docs API can export documents as HTML, preserving formatting that markdown export loses (precise styles, embedded images as data URIs, complex tables). HTML is also a valid input format for document creation.
- **Drive**: HTML files are a common file type.

Without an `html` scratchpad format, agents either get lossy plain-text conversions or raw HTML dumped into tool responses with no editing support.

### 2. Validation is the core differentiator

The scratchpad's value over raw `gws` CLI calls is that content is validated before it hits the API. But current validators are too shallow:

- **Markdown**: Only checks unclosed code fences. Doesn't catch broken link syntax, malformed tables, or unclosed emphasis.
- **CSV**: Checks column counts. Doesn't catch encoding issues or unescaped delimiters within fields.
- **JSON**: Uses `JSON.parse()` — good for syntax, but can't validate against expected schemas.
- **HTML**: Doesn't exist yet.

The scratchpad should be a **mini editor with real validation** — the agent's safety net before pushing content to Google Workspace. This is what distinguishes using the MCP server from shelling out to `gws` directly.

### 3. Google Docs comments are HTML-adjacent

A common review workflow involves reading a document, adding comments anchored to specific text, and resolving existing comments. The Google Drive API v3 supports comments with `htmlContent` bodies and anchor positions. This is naturally a scratchpad-adjacent capability:

- Import a doc into a scratchpad to review its content
- Read existing comments (anchored to content positions)
- Compose comment text in the scratchpad
- Post comments anchored to specific content

## Decision

### Add HTML as a fifth scratchpad format

```typescript
type ScratchpadFormat = 'text' | 'markdown' | 'json' | 'csv' | 'html';
```

The `html` format supports:

- **Line-addressed editing**: Same `insert_lines`, `replace_lines`, `remove_lines` operations as other formats
- **Validation on mutation**: HTML-aware linting after every edit
- **Import from Gmail**: `import(source: 'email', mode: 'html')` loads the HTML body instead of stripping to plain text
- **Import from Docs**: `import(source: 'doc', mode: 'html')` exports as HTML
- **Send to email**: HTML scratchpad content delivered as the HTML body of an email
- **Send to doc**: HTML content used for document creation

### Upgrade validation to real linting

Replace hand-written validators with proper linting libraries where they exist. The validator interface stays the same — `validate(lines, format) → status string` — but the implementation gets teeth.

| Format | Current | Proposed |
|--------|---------|----------|
| `text` | Always valid | Always valid (no change) |
| `markdown` | Unclosed code fences | Lint library: heading structure, link syntax, table formatting |
| `json` | `JSON.parse()` | `JSON.parse()` + optional schema validation when live-bound |
| `csv` | Column count | Column count + quoting/encoding checks |
| `html` | N/A | HTML parser: well-formedness, unclosed tags, nesting errors |

**Validation remains informational, not blocking.** The status line reports issues; mutations are never rejected. This lets agents work through intermediate invalid states (scaffolding, paste-then-fix).

### HTML sanitization for security

HTML from Gmail is an untrusted input that will be presented to the LLM. The import path must sanitize:

1. **Strip dangerous elements**: `<script>`, `<style>`, event handlers, `<iframe>`, `<object>`
2. **Strip CSS hidden content**: Elements styled with `display:none`, `visibility:hidden`, `font-size:0` — common prompt injection vectors
3. **Strip Unicode injection characters**: Tag Block (U+E0000-U+E007F), BiDi overrides, zero-width chars
4. **Wrap with provenance delimiters**: `<email_content source="gmail" trust="untrusted">` — Spotlighting pattern that research shows drops injection success from >50% to <2%

This sanitization runs at import time. Once in the scratchpad, the content is clean HTML that the agent can safely read and edit.

### Google Docs comment operations

Add comment operations to `manage_docs` via the Drive Comments API (v3):

| Operation | Description |
|-----------|-------------|
| `list_comments` | List comments on a document with content and anchor context |
| `add_comment` | Add a comment anchored to specific quoted text |
| `resolve_comment` | Resolve or reopen a comment thread |
| `reply_comment` | Add a reply to an existing comment thread |

Comments use `htmlContent` for rich text. When working with comments in the scratchpad, the `html` format provides natural editing support.

These operations are added as manifest entries + patches, following the inject-after-factory pattern (not scratchpad-specific). The scratchpad is the composition surface; comments are a Drive API capability.

### Import/send adapter updates

**Gmail adapter** gains an `html` mode:

```
import(scratchpadId, source: 'email', messageId, mode: 'html')
  → fetch FULL format → extract text/html MIME part
  → sanitize (strip scripts, hidden content, injection chars)
  → wrap with provenance delimiter
  → load into scratchpad as format: 'html'
```

**Gmail send adapter** gains HTML body support:

```
send(scratchpadId, target: 'email', ...)
  → if format is 'html': send as HTML body
  → if format is 'text'/'markdown': send as plain text (existing behavior)
```

**Docs adapter** gains HTML import/export:

```
import(scratchpadId, source: 'doc', documentId, mode: 'html')
  → export via files.export with mimeType 'text/html'
  → load into scratchpad as format: 'html'
```

### Linter dependency approach

Use lightweight, zero-dependency parsers where possible:

- **HTML**: A SAX-style parser for well-formedness checking (unclosed tags, nesting). No need for a full DOM — we're linting, not rendering. Evaluate `htmlparser2` (widely used, stream-based, ~50KB).
- **Markdown**: Evaluate `markdownlint` or a lighter alternative. Must handle CommonMark + GFM tables.
- **CSV**: Current implementation is adequate; minor hardening for edge cases.

Linters are optional dependencies — if they fail to load, fall back to the current basic validators. This keeps the server lightweight for users who don't use the scratchpad.

## Consequences

### Positive

- **HTML is a first-class citizen**: Agents can read, edit, and send HTML content without lossy conversion
- **Gmail HTML bodies are accessible**: Dates, tracking numbers, and structured data in HTML-only emails are no longer invisible
- **Validation catches real errors**: Agents get meaningful feedback before content hits the API — the scratchpad earns its keep as a safety net
- **Docs comments enable review workflows**: Read comments, add comments, resolve threads — collaborative document review becomes possible
- **Sanitization prevents prompt injection**: HTML import is safe by default, not by accident

### Negative

- **New dependency**: HTML parsing/linting adds a dependency. Must be carefully chosen for size and maintenance health.
- **Sanitization is a moving target**: Prompt injection techniques evolve. The sanitization stack needs periodic review.
- **Comment anchoring is fragile**: The Drive Comments API anchors to quoted text content, which can break if the document is edited between anchor creation and comment posting.

### Neutral

- Existing formats and workflows are unchanged — this is additive
- The `html` format uses the same line-addressed editing as all other formats
- Comment operations follow the established manifest + patch pattern
- Sanitization only runs at import time — in-buffer edits are not re-sanitized

## Alternatives Considered

### Return HTML inline in tool responses (original #91 proposal)

Add a `bodyFormat` parameter to the email read tool that returns raw or sanitized HTML directly in the tool response. Simpler to implement, but:

- No editing capability — the agent gets HTML but can't modify it
- No validation — errors discovered only at send time
- No reuse — HTML content can't be sent to other targets
- No sanitization boundary — raw HTML in the tool response is a prompt injection surface

The scratchpad approach provides all of these. The `bodyFormat` param may still be useful as a shortcut for read-only inspection, but the primary flow should go through the scratchpad.

### Separate HTML editor tool

Create a dedicated `manage_html` tool with its own buffer and operations. This fragments the editing surface — agents would need to learn two buffer systems. The scratchpad is already a general-purpose editor; adding a format is simpler than adding a tool.

### Use markdown as the universal interchange format

Convert everything to markdown: Gmail HTML → markdown, Docs → markdown. This is the current approach and it loses information. Tables with merged cells, precise styling, nested lists with specific formatting, and embedded content all degrade. HTML preserves what markdown cannot.
