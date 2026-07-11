---
status: Draft
date: 2026-07-11
deciders:
  - aaronsb
related: [ADR-304]
---

# ADR-101: Migrate test runner from Jest to Vitest

## Context

This package is ESM-native: `"type": "module"`, `module: node16`, and source that uses `import.meta.url`. The test runner has never been.

`jest.config.cjs` *declared* ESM — `preset: 'ts-jest/presets/default-esm'`, `useESM: true`, `extensionsToTreatAsEsm: ['.ts']` — but the test script never set `NODE_OPTIONS=--experimental-vm-modules`, so Jest ran under CommonJS the entire time. The ESM configuration was inert. Nobody noticed, because nothing failed.

Three consequences follow from that mismatch.

**1. Suite-load failures report as success.** When an ESM-only transitive fails to parse, Jest reports:

```
Test Suites: 15 failed, 23 passed, 38 total
Tests:       456 passed, 456 total     <-- zero failures
```

222 tests stopped running and **not one test was marked failed**, because a suite that fails to *load* contributes no test results. Only a diff against a known baseline caught it.

**2. CJS Jest cannot load ESM-only dependencies at all.** Jest resolves modules through its own registry, not Node's `require()`, so Node's `require(ESM)` support is irrelevant to it: an ESM-only transitive fails with `SyntaxError: Cannot use import statement outside a module` on *any* Node version. This is a hard ceiling on what the project can depend on.

**3. Production code carries a test-runner accommodation.** `src/factory/registry.ts` uses `import.meta.url` to resolve the manifest directory. CJS Jest cannot parse `import.meta`, so `generator.ts` grew a `setModuleDir()` injection shim (its comment: *"Null in Jest (CJS) — falls back to cwd-based resolution"*), and five test files mock `registry.js` outright to dodge the runner (*"avoids `import.meta.url` in Jest"*). The runner is shaping the source.

Separately, `ts-jest` pulls in a critical `handlebars` advisory.

### What this ADR does *not* fix

An earlier draft claimed this migration unblocks the `sanitize-html` pin. **That was wrong**, and the error is worth recording.

`sanitize-html` 2.17.3 has a critical XSS (GHSA-rpr9-rxv7-x643) on the path we use to sanitize untrusted email HTML. The fix requires 2.17.6, which moves to the pure-ESM `htmlparser2@12`. #135 shipped the fix by pinning to exactly `2.17.5`.

Taking `^2.17.6` has **two independent blockers**:

- **(a) Test-time.** CJS Jest cannot parse the ESM-only transitive. *This ADR removes that one.*
- **(b) Runtime.** `sanitize-html` is itself **CommonJS** (`node_modules/sanitize-html/index.js:1` is `require('htmlparser2')`). A CJS `require()` of an ESM-only package only resolves on Node **≥20.19 / ≥22.12**. The README advertises **Node 18+** and `package.json` declared no `engines` field, so on Node 18 the server would crash at startup with `ERR_REQUIRE_ESM` on the first import of `html-sanitize.ts`.

The original draft reasoned "production is unaffected because *this package* is ESM" — but the module doing the `require()` is `sanitize-html`, not us. Blocker (b) is a **Node floor decision**, not a test-runner one, and it is a breaking change for npm consumers (and therefore for the `.mcpb` bundle, which resolves the published package). It is tracked separately.

`sanitize-html` therefore stays pinned at `2.17.5` in this change. An `engines: ">=18.0.0"` field is added — accurate today, and the guard whose absence let blocker (b) go undetected.

## Decision

**Replace Jest with Vitest.**

Vitest runs ESM natively — no experimental Node flag, no `unstable_` API. Its `vi.mock` hoists the way `jest.mock` does under CJS, so the existing mock-then-import file structure is preserved rather than rewritten.

- `vitest.config.ts` replaces `jest.config.cjs`.
- `include` stays repo-wide (`**/__tests__/**/*.test.ts`), matching Jest's old `testMatch`, so a test added outside `src/` is not silently skipped. `exclude` keeps Vitest's defaults and adds `build/` and `mcpb/`, which hold compiled copies of the tests.
- `fileParallelism: false` preserves Jest's `--runInBand`. The integration suites shell out to the real `gws` binary against live Google APIs using one shared OAuth credential; running their files in parallel races the token refresh and trips rate limits.
- `clearMocks: true` replaces `testSetup.ts`.
- Test globals are **imported explicitly** rather than enabled via `globals: true`. Ambient globals would require a `/// <reference types="vitest/globals" />` inside `src/`, which is compiled into the production program — a stray `vi.fn()` left in `src/server/handler.ts` would type-check and ship.
- `jest`, `ts-jest` and `@types/jest` are removed. The `Makefile`'s `test-unit` / `test-integration` targets are ported to Vitest, preserving the unit (mocked, no network) / integration split that `make check` depends on.

This decision was validated by a full prototype **and an adversarial code review** before adoption; the review is what caught the `sanitize-html` error above.

## Consequences

### Positive

- **Removes a critical dev advisory.** Dropping `ts-jest` eliminates `handlebars` (critical). Dev vulnerabilities go 12 → 10; the remainder are the eslint/typescript-eslint majors, tracked separately.
- **Lifts the ceiling on ESM-only dependencies at test time**, which is a *precondition* for `sanitize-html ^2.17.6` (the other precondition being the Node floor).
- **Unblocks removing the `setModuleDir()` shim** and the five `registry.js` mocks that exist only to dodge CJS Jest — i.e. lets production code stop accommodating the test runner.
- **Missing exports on mocked modules now fail loudly.** `server.test.ts` mocked only 2 of the 4 SDK schemas `server.ts` imports; Vitest refuses to resolve the missing ones. (Honest scope: this was *not* a false pass — the pre-existing `beforeAll` already selected handlers by schema key, so the two undefined entries were skipped rather than asserted on. It is a correctness tightening, not a bug that was firing.)

### Negative

- **Vitest applies `new` to a mock implementation**, so arrow functions cannot be used for constructor mocks (`() => ({...})` throws "is not a constructor"). Jest's CJS wrapper hid this.
- **`vi.mock` factories that spread `importActual` must be `async`**, and `importActual` needs a generic to be typed rather than `unknown`.
- **`vi.mock` hoists above module-level `const`s**, so factory captures must come from `vi.hoisted()`.
- **Type-checking of test files no longer happens during `npm test`.** `ts-jest` ran with diagnostics on; Vitest strips types via esbuild without checking. Mitigated — `npm run type-check` and the CI build both run `tsc` over `src/**`, which includes the tests — but the in-test-run guard is gone.
- Vitest is a smaller ecosystem than Jest. No Jest-specific plugins are in use here.

### Neutral

- Test count is unchanged: **691 before, 691 after.** This is a runner swap, not a coverage change.
- The MCP `resources/list` and `resources/read` handlers have **zero test coverage**. This predates and is unchanged by this ADR, but the review surfaced it and it should be filed.
- The five duplicated `registry.js` mock factories remain, and their comments still reference Jest. They go away with the `setModuleDir()` cleanup.

## Evidence

Prototyped on `spike/vitest`, then reviewed adversarially. Measured, not asserted:

| | Jest (before) | Vitest (after) |
|---|---|---|
| Suites / tests | 38 / 691 passing | **38 / 691 passing** |
| `sanitize-html` | pinned `2.17.5` | **pinned `2.17.5`** (unchanged — see Context) |
| Production vulns | 0 | **0** |
| Dev vulns | 12 (1 critical) | **10 (0 critical)** |
| devDependencies | 9 | **6** |
| `make check` | passes | **passes** |

Unit suite verified network- and credential-free: 681/681 with an empty credential home.

Migration cost: ~30 files converted mechanically (`jest.` → `vi.`); three required human judgment, listed under Negative.

## Alternatives Considered

**Jest with real ESM** (`--experimental-vm-modules` + `unstable_mockModule`). Honors the config's stated intent, but `jest.mock` does not work under ESM: it depends on CJS hoisting. The ESM path requires converting each module-under-test to a dynamic `await import()`, restructuring the imports of **18 of 33 test files** — and landing the whole suite on an API Jest itself labels `unstable_`, behind an experimental Node flag. Strictly more invasive than Vitest, for a worse endpoint.

**Stay on CJS deliberately.** Drop the ESM pretence, add `babel-jest` for `node_modules` and allowlist ESM-only transitives in `transformIgnorePatterns`. Config-only; touches no test files. Rejected: it entrenches a CJS test runner under an ESM codebase, so the production `setModuleDir()` shim stays forever, tests keep mocking `registry.js` to dodge the runner, and every future ESM-only dependency re-runs this exercise. It treats the symptom.

**Do nothing.** Rejected: the suite-load-failure blind spot (222 tests silently not running while the report read green) is on its own sufficient reason to move, independent of any dependency.
