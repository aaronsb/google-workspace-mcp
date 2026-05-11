---
status: Accepted
date: 2026-05-11
deciders:
  - aaronsb
related:
  - ADR-301
  - ADR-302
---

# ADR-305: Shared HTML sanitization for agent-facing authoring

## Context

HTML is the lingua franca of Google Workspace content, and it shows up in several places the agent needs to read, write, or edit:

- **Gmail**: message bodies are HTML. The plain-text part is often a lossy stub ("view this email in your browser") for marketing email, booking confirmations, and rich notifications — meaningful content (dates, tracking codes, order numbers) lives only in the HTML part. Issue #91 is the concrete trigger: a Paperless Post invitation whose date and time were unreachable through `manage_email` `read` because the tool stripped HTML to plain text before returning. Today `extractBodyFromPayload` prefers `text/plain` over `text/html` and falls back to a crude `stripHtml()` regex when there's no plain part.
- **Scratchpad** (ADR-302, Draft): an `html` buffer format is planned so agents can edit Gmail message bodies, Docs HTML exports, and Drive HTML files using the same line-addressed surface that handles markdown/json/csv.
- **Docs** export: the Docs API can return HTML preserving formatting that markdown export drops; future imports of HTML into the scratchpad need the same handling.
- **Drive**: HTML files are common; reading them into an agent today returns the raw text via the workspace, with no sanitization.

There's a common requirement underneath: **any HTML that crosses into agent-facing text is a prompt-injection surface**. Style/script blocks, event handlers, CSS-hidden content (display:none, visibility:hidden, off-screen positioning, zero opacity), tag-block Unicode characters (U+E0000–U+E007F), bidi overrides (U+202A–U+202E, U+2066–U+2069), and zero-width characters have all been used in published attacks against LLM applications that consume HTML email or scraped web content. Microsoft's LLMail-Inject research (NeurIPS 2024) found that simple Spotlighting delimiters — wrapping untrusted content in a tagged block — drop injection success from >50% to under 2% even before any sanitization, and the combination is markedly stronger than either alone.

Today's `stripHtml()` is too lossy for the "I need the structured content" case (the issue's complaint) and too permissive for the "I want to render raw HTML" case (it leaves attribute values, ignores hidden content, has no injection-character handling). Both cases need a single, shared, deliberately-built sanitizer — not a regex bolted onto one tool.

The author of issue #91 proposed a four-layer stack (CSS-hidden stripping, allowlist sanitization, Unicode injection-char removal, Spotlighting delimiters) using `sanitize-html`. This ADR adopts that direction and lifts it to a project-wide utility so the scratchpad, Docs, and Drive paths can share it.

## Decision

Add a single sanitization module — `src/server/formatting/html-sanitize.ts` — that any agent-facing path can call when emitting or ingesting HTML. Gmail `read` is the first consumer; the scratchpad (ADR-302) and future Docs/Drive HTML paths adopt it as they land.

### The sanitization stack

In order, every time HTML crosses into agent-facing text:

1. **CSS-hidden element removal** — via `sanitize-html`'s `exclusiveFilter`, drop any element with `display:none`, `visibility:hidden`, `opacity:0`, off-screen positioning (`text-indent:-9999px`, `left:-9999px`), or `aria-hidden="true"`. The filter sees the full attribute set and CSS, so it handles nested hidden subtrees — the most common real-world injection pattern (hidden instructions inside a visible-looking email).
2. **Tag/attribute allowlist** — `sanitize-html` with a content-focused allowlist: block and inline structural tags (`h1`–`h6`, `p`, `div`, `span`, `ul`/`ol`/`li`, `table`/`thead`/`tbody`/`tr`/`th`/`td`, `blockquote`, `pre`, `code`, `b`/`i`/`em`/`strong`/`u`, `a`, `img`, `br`, `hr`), plus `href` on `a` (only `http`/`https`/`mailto:` schemes — `javascript:`, `data:`, `vbscript:` blocked), and `src`/`alt` on `img` (only `http`/`https`/`cid:` schemes). No `style`, no `class`, no `id`, no event handlers, no `script`, no `iframe`, no `object`, no `embed`.
3. **Unicode injection-character removal** — strip Tag Block (U+E0000–U+E007F), bidi overrides (U+202A–U+202E, U+2066–U+2069), zero-width characters (U+200B, U+200C, U+200D, U+FEFF), and other non-rendering characters that have been used to smuggle invisible instructions past human review.
4. **Spotlighting delimiters** — wrap the sanitized output in a tagged block that names the source and the trust level, e.g. `<email_content source="gmail" trust="untrusted">…</email_content>`. The wrapper is plain text the LLM can attend to but the agent's downstream reasoning is conditioned to treat as content, not instructions.

The module exports a single function: `sanitizeHtmlForAgent(html: string, { source: string }): string`. Callers identify the source (`gmail`, `docs`, `drive`, `scratchpad-import`); the module fills in `trust="untrusted"` (everything coming through this path is, by definition, untrusted).

### Gmail `read` — `bodyFormat` parameter

`manage_email` `read` gets an optional `bodyFormat?: 'plain' | 'html'` parameter (default `'plain'` — current behavior unchanged). When `'html'`:

- Prefer the `text/html` MIME part; fall back to the `text/plain` part if no HTML exists.
- Run the extracted HTML through `sanitizeHtmlForAgent({ source: 'gmail' })` before returning.
- Surface the sanitized HTML in the response body, replacing the stripped-text body.

The default stays `'plain'` so existing callers and prompts see no change. Agents that need the structured content opt in per-call.

### Dependency: `sanitize-html`

Add `sanitize-html` (and `@types/sanitize-html`) to the project's runtime dependencies. It's the canonical HTML sanitizer in the npm ecosystem, actively maintained, with a long track record in security-sensitive code (Mozilla Bugzilla, IBM products, npm itself). The transitive surface is small (`htmlparser2`, `domhandler`, `dom-serializer`, `parse-srcset`, `postcss`) and confined to parsing/serialization — no DOM, no JS execution. Pinned at `^2.x`.

### What's not in scope here

- **`bodyFormat: 'raw_mime'`** (the third mode the issue author proposed) is deferred. Handing raw MIME — unparsed, unsanitized — to the agent reintroduces every threat this ADR exists to mitigate; the use case (debugging, header forensics) is real but a future ADR can decide whether to expose it (e.g. behind a `--unsafe` flag or as a separate operation with a hard-wired warning).
- **Markdown conversion of HTML.** A future iteration could return well-structured markdown instead of sanitized HTML — preserving structure for the agent while avoiding markup altogether. Worth exploring; doesn't replace the need for the sanitization stack (the conversion library would itself need to defend against injection), so it stacks on top of, not instead of, this ADR.

## Consequences

### Positive

- Issue #91 closes: HTML-only message content (dates in invitations, tracking links, confirmation codes) reaches the agent.
- One sanitization module for the whole project. ADR-302's html scratchpad format inherits it when implemented; Drive and Docs HTML paths inherit it when added. No drift between services.
- The threat model is documented in one place. New consumers don't re-invent sanitization or skip it.
- Default behavior unchanged — no caller breakage.

### Negative

- New runtime dependency (`sanitize-html` + transitives). The project went from 3 to 4 runtime deps; the transitive surface (parsing/serialization only, no DOM) is small but real.
- Sanitized HTML is larger than stripped text — calls that opt into `bodyFormat: 'html'` consume more tokens. The agent decides per call.
- Sanitization is best-effort: novel injection vectors will appear and the allowlist will need maintenance. The risk is bounded (default-off; output is text not rendered HTML) but not zero.

### Neutral

- The `extractBodyFromPayload` API gains a `format` parameter; existing callers default to `'plain'`. Internal change, no schema impact beyond the new `bodyFormat` param on the `read` op.
- A future "smart HTML→markdown" path can be added alongside without removing the HTML one (different trade-offs for different agents).

## Alternatives Considered

**Hand-rolled sanitizer, no new dependency.** Keeps the dep count at three. Rejected: HTML sanitization is a famously deep problem (XSS bypasses against custom sanitizers are a recurring CVE category — see the OWASP cheatsheet's "if you're writing your own, you're doing it wrong"). The cost of getting a hand-rolled allowlist wrong here is an LLM following an attacker's instructions; the cost of the dependency is a parsing library. Wrong trade-off.

**Smarter plain-text extraction (no HTML returned).** Convert HTML to well-structured markdown (tables → markdown tables, lists → markdown lists, links → `[text](url)`) and return that. Lower attack surface — no markup hits the LLM — but a substantial new dependency (or an even bigger hand-roll) AND it still needs the Unicode and CSS-hidden filtering. Not mutually exclusive with this ADR; deferred as the next iteration.

**Gmail-only sanitization, not a shared module.** Implement the sanitizer inside `src/services/gmail/` and let other services add their own when they need it. Rejected: HTML sanitization is exactly the kind of cross-cutting concern that becomes drift when each service rolls its own. The "Full Coverage for Cross-Cutting Features" project way (`.claude/ways/factory`) argues for committing to all-services scope at design time even if implementation lands incrementally.

**Sanitize on `'plain'` too** (i.e., apply the Unicode-strip and Spotlighting to the stripped-text path). Tempting because it would harden the default. Deferred: the current `'plain'` path is the existing behavior and changing it risks subtle output changes for every existing caller. The Spotlighting wrapper in particular is visible content the agent sees, which is a UX shift, not just a sanitization change. Worth a follow-up ADR once the `'html'` path has settled.
