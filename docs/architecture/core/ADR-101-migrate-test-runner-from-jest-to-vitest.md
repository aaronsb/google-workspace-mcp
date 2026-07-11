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

Three defects trace to that single mismatch, and all three were invisible in the place you would look for them.

**1. A critical security patch was blocked.** `sanitize-html` 2.17.3 carries a critical XSS (GHSA-rpr9-rxv7-x643) on the path we use to sanitize untrusted email HTML. The fix is available, but `sanitize-html` 2.17.6 moves to `htmlparser2 ^12`, which is pure ESM with no CommonJS build. Production is unaffected. CJS Jest cannot parse it. We shipped the fix in #135 only by pinning to exactly `2.17.5` — the last version on `htmlparser2 ^10` — which blocks every future patch to a package that just had a critical XSS. That pin is the direct cost of the test runner.

**2. Suite-load failures reported as success.** When the ESM-only transitive failed to parse, Jest reported:

```
Test Suites: 15 failed, 23 passed, 38 total
Tests:       456 passed, 456 total     <-- zero failures
```

222 tests stopped running and **not one test was marked failed**, because a suite that fails to *load* contributes no test results. Only a diff against a known baseline caught it.

**3. Production code carries a test-runner accommodation.** `src/factory/registry.ts` uses `import.meta.url` to resolve the manifest directory. CJS Jest cannot parse `import.meta`, so `generator.ts` grew a `setModuleDir()` injection shim, and `server.test.ts` and `accounts.test.ts` mock `registry.js` outright — their comments say so: *"avoids `import.meta.url` in Jest."* The runner is shaping the source, and real modules are stubbed out in tests for tooling reasons rather than test-design reasons.

There are also two latent hazards: no `modulePathIgnorePatterns`, so the haste map scans `build/` and finds duplicate copies of `__mocks__/executor` (ambiguous mock resolution — a plausible cause of one unreproducible failure observed in nine consecutive runs); and `ts-jest` pulls in a critical `handlebars` advisory.

## Decision

**Replace Jest with Vitest.**

Vitest runs ESM natively — no experimental Node flag, no `unstable_` API. Its `vi.mock` hoists the way `jest.mock` does under CJS, so the existing mock-then-import file structure is preserved rather than rewritten.

`vitest.config.ts` replaces `jest.config.cjs`. `globals: true` keeps `describe`/`it`/`expect` ambient, so no per-file import churn. `clearMocks: true` replaces `testSetup.ts`. `exclude: ['build/**', 'mcpb/**']` fixes the duplicate-mock hazard.

`sanitize-html` is unpinned to `^2.17.6`. `jest`, `ts-jest` and `@types/jest` are removed.

This decision was validated by a full prototype before adoption, not chosen on paper — see Evidence.

## Consequences

### Positive

- **Unpins `sanitize-html`.** The suite passes on `^2.17.6` with pure-ESM `htmlparser2@12` — the exact combination that silently killed 15 Jest suites.
- **Removes a critical dev advisory.** Dropping `ts-jest` eliminates `handlebars` (critical). Dev vulnerabilities go 12 → 10; the remainder are the eslint/typescript-eslint majors, tracked separately.
- **Missing exports on mocked modules now fail loudly.** Vitest surfaced a real latent bug: `server.test.ts` mocked only 2 of the 4 SDK schemas `server.ts` imports, so `ListResourcesRequestSchema` and `ReadResourceRequestSchema` were `undefined` and the resource handlers were being registered under `undefined` keys. The test passed anyway under CJS. This is the same "green but not testing anything" class as defect 2 above.
- **Unblocks removing the `setModuleDir()` shim**, letting `import.meta.url` be used directly and letting tests stop mocking `registry.js` to dodge the runner.
- Fixes the duplicate-manual-mock ambiguity.

### Negative

- **Vitest applies `new` to a mock implementation**, so arrow functions cannot be used for constructor mocks (`() => ({...})` throws "is not a constructor"). Jest's CJS wrapper hid this. One file affected; documented inline.
- **`vi.mock` factories that spread `importActual` must be `async`**, and `importActual` needs a generic to be typed rather than `unknown`.
- **`vi.mock` hoists above module-level `const`s**, so factory captures must come from `vi.hoisted()`. One file affected.
- Vitest is a smaller ecosystem than Jest. Its `expect` is Chai-based with Jest compatibility; exotic matchers or Jest-specific plugins could need work. None are in use here.

### Neutral

- Test count is unchanged: **691 before, 691 after.** This is a runner swap, not a coverage change.
- `@vitest/coverage-v8` replaces Jest's coverage. `coverage-baseline.json` may need regenerating.
- CI is unaffected: it runs `npm test`, which now invokes `vitest run`.

## Evidence

Prototyped on branch `spike/vitest` before this ADR was written. Measured, not asserted:

| | Jest (before) | Vitest (after) |
|---|---|---|
| Suites / tests | 38 / 691 passing | **38 / 691 passing** |
| `sanitize-html` | pinned `2.17.5` | **`^2.17.6`** |
| Production vulns | 0 | **0** |
| Dev vulns | 12 (1 critical) | **10 (0 critical)** |
| duplicate-mock warnings | 3 per run | **0** |
| devDependencies | 9 | **7** |

Migration cost, honestly: ~30 files converted mechanically (`jest.` → `vi.`). **Three** required human judgment — the three Negatives above. Type-check, lint and build clean.

## Alternatives Considered

**Jest with real ESM** (`--experimental-vm-modules` + `unstable_mockModule`). Honors the config's stated intent, but `jest.mock` does not work under ESM: it depends on CJS hoisting. The ESM path requires `jest.unstable_mockModule` plus converting each module-under-test to a dynamic `await import()`, restructuring the imports of **18 of 33 test files** — and landing the whole suite on an API Jest itself labels `unstable_`, behind an experimental Node flag. Strictly more invasive than Vitest, for a worse endpoint.

**Stay on CJS deliberately.** Drop the ESM pretence, add `babel-jest` for `node_modules` and allowlist `htmlparser2` in `transformIgnorePatterns`. Config-only; touches no test files; unpins `sanitize-html` today. Rejected: it entrenches a CJS test runner under an ESM codebase, so the production `setModuleDir()` shim stays forever, tests keep mocking `registry.js` to dodge the runner, and the next ESM-only transitive re-runs this whole exercise. It treats the symptom.

**Pin `sanitize-html` and defer.** What #135 did as a stopgap. Rejected as a permanent answer: it leaves a package with a recent critical XSS frozen at an exact version, unable to take future patches. The pin is a debt, and this ADR is how it gets paid.
