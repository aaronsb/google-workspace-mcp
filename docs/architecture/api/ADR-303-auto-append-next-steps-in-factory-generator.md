---
status: Draft
date: 2026-04-15
deciders:
  - aaronsb
related:
  - ADR-300
---

# ADR-303: Auto-append next-steps in factory generator

## Context

The factory generator in `src/factory/generator.ts` appends `nextSteps()` guidance footers only on the resource/helper path (lines 224–230). Custom handlers — registered via `patch.customHandlers[op]` — short-circuit at line 181–183 and return their response directly, bypassing the append step.

Every existing patch works around this by calling `nextSteps('domain', 'op', { email: account })` inline in each handler's return statement:

```ts
// src/services/docs/patch.ts
return {
  text: `Text inserted at index ${index}.\n\n**Document:** ${documentId}...` +
    nextSteps('docs', 'insertText', { email: account }),
  refs: { documentId, index, length: text.length },
};
```

The convention isn't enforced anywhere — it's a norm the author has to know. PR #103 (sheets expansion, 8 new custom handlers) shipped with the footer calls omitted from every handler. The bug was caught in review, but every future service with custom handlers is one forgotten call away from the same regression.

Every patch that needed context richer than `{email}` also reinvented the same helper:

```ts
// Introduced in PR #103 review fix — reconstructs what the generator already builds internally
function handlerContext(params: Record<string, unknown>, account: string): Record<string, string> {
  const ctx: Record<string, string> = { email: account };
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') ctx[key] = value;
  }
  return ctx;
}
```

That code duplicates lines 205–209 of the generator. Two copies of the same context-building logic, in different files, maintained independently.

Framing concerns (next-steps, session context injection) are the factory's job. Handlers should produce the response; the factory should frame it.

## Decision

Move `nextSteps()` application out of individual custom handlers and into the factory generator. After a custom handler returns, the generator appends next-steps the same way it does for the resource/helper path.

In `src/factory/generator.ts`, replace:

```ts
if (patch?.customHandlers?.[operation]) {
  return patch.customHandlers[operation](params, account);
}
```

with an equivalent block that runs after the custom handler resolves, applies the same `contextMap` built from params + account, and uses `patch.nextSteps` override if present or the default `nextSteps(domain, operation, contextMap)` otherwise. The resource/helper path's append becomes the single source of truth for both paths.

Custom handlers return `{ text, refs }` describing just their work — no framing. The generator owns framing.

### Migration

1. Update `src/factory/generator.ts` to append next-steps on the custom-handler path.
2. Remove inline `nextSteps()` calls from every custom handler in:
   - `src/services/gmail/patch.ts`
   - `src/services/calendar/patch.ts`
   - `src/services/drive/patch.ts`
   - `src/services/docs/patch.ts`
   - `src/services/meet/patch.ts`
   - `src/services/sheets/patch.ts`
3. Delete the `handlerContext()` helper from `sheets/patch.ts` — the generator's context map subsumes it.
4. Strip `nextSteps` imports from patch files that no longer need them.
5. Keep `patch.nextSteps` override hook for services that want per-operation control — it continues to work unchanged.

Both phases land in one commit so no interim state ships a double-append.

## Consequences

### Positive

- Custom handlers can no longer ship dead guidance by forgetting one function call. The failure mode that surfaced in PR #103 review becomes structurally impossible.
- Single source of truth for the context map that resolves `<email>`, `<spreadsheetId>`, etc. in next-steps placeholders. No more two-copy drift.
- Custom handlers shrink. Every inline `+ nextSteps(...)` on a return expression goes away.
- Framing stays where framing lives — the factory already handles session context injection, blocked-policy messages, and afterExecute hooks. Next-steps joins the same lifecycle.

### Negative

- Custom handlers lose per-response control over the footer. A handler can no longer conditionally omit next-steps or craft a response-shape-specific footer.
  - Mitigation: `patch.nextSteps` override hook still exists and runs per-operation with the same context. A service that needs conditional logic can implement it there.
  - No existing handler uses conditional next-steps — every current call site is unconditional.

### Neutral

- The migration touches every service patch file. Mechanical change (delete one `+ nextSteps(...)` per return) but broad. Lands as one commit since partial application would cause double-append.
- Does not change the `nextSteps()` function itself, the `src/server/formatting/next-steps.ts` entries, or the placeholder resolution logic.

## Alternatives Considered

**Keep the convention, add a lint rule.** Write a test or ESLint rule that fails if a custom handler's return doesn't include a `nextSteps(` call. Rejected: enforces the right pattern but doesn't eliminate the duplication, and a lint rule is easy to silence inadvertently. The factory owning the concern is the deeper fix.

**Add a "bring your own next-steps" flag on `HandlerResponse`.** Let handlers opt out of auto-append via a response field. Rejected: solves a problem no existing handler has. Adds API surface for a hypothetical need. If the need arises, it can be added later without breaking callers.

**Wrap custom handlers with a decorator at registration time.** Transform each `customHandlers[op]` function when the patch is imported so every return gets the footer appended. Rejected: hides the behavior one level further (the wrapping happens outside the generator) and makes testing harder — the generator is where the lifecycle is visible and documented.

**Leave it as a convention and document harder.** Add a comment to the `customHandlers` field in `src/factory/types.ts` reminding authors to call `nextSteps()`. Rejected: this is the current state. It failed in PR #103 despite every other patch already doing it. Conventions that only work when you remember them aren't conventions; they're footguns.
