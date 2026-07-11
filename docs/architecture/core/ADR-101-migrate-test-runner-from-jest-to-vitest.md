---
status: Accepted
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

`sanitize-html` 2.17.3 has a critical XSS (GHSA-rpr9-rxv7-x643) on the path we use to sanitize untrusted email HTML.

**We are not exposed to it.** The advisory's vulnerable range is 2.17.3 alone; **2.17.5 carries the fix**, and #135 shipped it by pinning to exactly that version. `npm audit --omit=dev` reports 0 production vulnerabilities on this branch. *Do not bump `sanitize-html` believing the XSS is unpatched — it is not.*

What the exact pin costs us is the ability to take **future** patches: 2.17.6 moves to the pure-ESM `htmlparser2@12`, and taking `^2.17.6` has **two independent blockers**:

- **(a) Test-time.** CJS Jest cannot parse the ESM-only transitive. *This ADR removes that one.*
- **(b) Runtime.** `sanitize-html` is itself **CommonJS** (`node_modules/sanitize-html/index.js:1` is `require('htmlparser2')`). A CJS `require()` of an ESM-only package only resolves on Node **≥20.19 / ≥22.12**. The README advertises **Node 18+** and `package.json` declared no `engines` field, so on Node 18 the server would crash at startup with `ERR_REQUIRE_ESM` on the first import of `html-sanitize.ts`.

The original draft reasoned "production is unaffected because *this package* is ESM" — but the module doing the `require()` is `sanitize-html`, not us. Blocker (b) is a **Node floor decision**, not a test-runner one, and it is a breaking change for npm consumers (and therefore for the `.mcpb` bundle, which resolves the published package). It is tracked separately.

`sanitize-html` therefore stays pinned at `2.17.5` in this change.

An `engines` field is added. Two distinct floors exist, and conflating them is what produced the original error:

- **Consumers** need **Node ≥18.14.1** — the strictest floor across the *production* dependency tree (`@hono/node-server`, via the MCP SDK). This is what `engines.node` declares, since the published package ships only `build/` and the production deps.
- **Contributors** need **Node ≥20.19** — Vitest requires `^20.19 || ^22.12 || >=24`. This is a development-environment constraint, not a consumer one, so it belongs in CONTRIBUTING.md rather than `engines`.

But **`engines` is a declaration, not a guard.** npm only warns on a mismatch, and every CI job here runs Node 20 while the dev box runs 26 — so the floor we *publish* was executed by nothing, which is precisely how blocker (b) reached a merge-ready branch. A version that is fine on the Node you test and broken on the Node you ship is invisible to every check that runs on the Node you test.

So the floor is now a **tested** claim: a CI job (`engines-floor`) builds on Node 20, then runs the built server on Node **18.14.1** against the *production* dependency tree (`npm ci --omit=dev`) and asserts it completes an MCP handshake with its tools loaded (`scripts/smoke-start.mjs`, also wired into `make check`). Falsified rather than assumed: with `sanitize-html@2.17.6` installed, the smoke test fails with the real `ERR_REQUIRE_ESM` — and passes on Node 26 with the identical broken tree, which is exactly why the suite and all four CI jobs missed it.

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
- **Removed the `setModuleDir()` shim** and the five `registry.js` mocks that existed only to dodge CJS Jest — production code no longer accommodates the test runner. `generator.ts` now reads `import.meta.url` directly (`bc35dff`, net −67/+23 lines), and those five tests exercise the **real** registry instead of a stub that re-implemented it. Verified against the case the shim existed for: the built server resolves its manifest with `cwd=/tmp` and `cwd=/` (npx / `.mcpb`).

- **Manifest resolution no longer hides a broken build.** The shim removal left a four-candidate fallback chain, which reads as resilience and functions as concealment. `MODULE_DIR/manifest` already covers both real cases (it *is* `src/factory/manifest` under vitest and `build/factory/manifest` in the built server), so the other three candidates fire only when the built manifest is *missing* — and the `src/` fallback among them exists **only in a dev checkout**. A `build/` shipped without its manifest therefore resolved fine locally and in CI, and threw on the consumer's first `npx` start: the exact cwd-independence failure the shim was originally written to prevent, reintroduced by its replacement. The chain is now a single module-relative path that throws immediately, on every machine.

  Relatedly, `resolveManifestDir()` accepted any directory containing *at least one* `.yaml` — presence, not integrity. An interrupted `cp -r` (the build is `rm -rf && cp -r`, which is not atomic) would leave a subset, and the server would boot with a partial toolset, silently. Measured, not assumed: deleting six of the seven service YAMLs from `build/` and starting the server yields **5 tools instead of 11** — the six lost services are manifest-generated, while `manage_accounts`, `manage_workspace`, `manage_scratchpad` and `queue_operations` are hand-written and survive. An agent silently loses Gmail and Drive with nothing logged anywhere.

  A `postbuild` step (`scripts/check-build.mjs`) now asserts the built manifest is the same *set* as the source manifest — and then **asks the loader**: it imports the built `loadManifest()` and confirms it actually resolves every expected service, rather than trusting its own second opinion about which files count. `prepublishOnly` rebuilds (and now stamps the version, which `npm run build` never did — publishing outside `make publish-all` shipped the previous version's `version.js` while `prepublishOnly`'s presence made it look handled).
- **Missing exports on mocked modules now fail loudly.** `server.test.ts` mocked only 2 of the 4 SDK schemas `server.ts` imports; Vitest refuses to resolve the missing ones. (Honest scope: this was *not* a false pass — the pre-existing `beforeAll` already selected handlers by schema key, so the two undefined entries were skipped rather than asserted on. It is a correctness tightening, not a bug that was firing.)

### Negative

- **Vitest applies `new` to a mock implementation**, so arrow functions cannot be used for constructor mocks (`() => ({...})` throws "is not a constructor"). Jest's CJS wrapper hid this.
- **`vi.mock` factories that spread `importActual` must be `async`**, and `importActual` needs a generic to be typed rather than `unknown`.
- **`vi.mock` hoists above module-level `const`s**, so factory captures must come from `vi.hoisted()`.
- **Type-checking of test files no longer happens during `npm test`.** `ts-jest` ran with diagnostics on, so a type error in a test failed the run; Vitest strips types via esbuild without checking. This guard has to be *replaced*, not assumed: a draft of this ADR claimed it was "mitigated" by `tsc` running over `src/**`, but the build's tsconfig deliberately excludes tests (see Decision), and no gate invoked `tsconfig.test.json`. A deliberate type error in a test file passed `make check`, `npm test`, `npm run build` and `npm run lint`. It is now covered by an explicit `type-check` CI job and by `make typecheck` delegating to `npm run type-check`.

- **An allowlist can orphan tests.** `npm test` runs a vetted list of mocked directories rather than "everything except integration", so a test added elsewhere would be collected by no gate at all — green CI, dead test. `scripts/check-test-gates.mjs` fails the build if any test file is collected by no gate.

  **The first version of that script was itself an instance of the bug it exists to catch**, and this is the most instructive thing in this ADR. It asked *"is this file's path under a gate directory?"* while vitest asks *"does this path match `**/__tests__/**/*.test.ts`?"* — different questions that agree for five of the six gate dirs and disagree for `src/server/scratchpad`, a *source* dir whose tests live in a subdir. A `.test.ts` dropped directly in it was reported "covered by a gate" and collected by nothing. An earlier draft of this ADR asserted "(Verified by probe: an orphan test file makes `make check` exit non-zero.)" — true of the one orphan shape that had been probed, false as the general guarantee it was written as. A fourth review round caught it; four independent finders reproduced it.

  The fix is the lesson: **do not re-derive what the runner collects — ask it.** The script now shells out to `vitest list --filesOnly` for each gate and compares that against a *filesystem* walk (not `git ls-files`, which cannot see the unstaged new test a developer is about to trust `make check` about).

  A *fifth* review round then found two more false passes in that rewrite, both of the same kind — the walk still measured a narrower universe than vitest does. It was rooted at `src/` while vitest's `include` is repo-wide, so a test at `scripts/__tests__/` was collected by vitest, run by no gate, and never even walked. And its skip-list matched bare **basenames at any depth**, so `src/coverage/` — a real source directory — was silently pruned because the list contained `coverage` for the report-output directory at the repo root. The walk now starts at the repo root and skips *root-relative paths*. The same round found that the "does CI actually invoke this gate?" flag was a substring match over the whole workflow file **including its comments** — three comments mention `npm test`, so deleting the real `- run: npm test` step left the flag true. It now parses the `run:` steps.

  That is the third distinct instance of this bug inside the guard written to catch the bug. It is not a coincidence, and the reason is worth naming: *every one of them came from re-deriving what another tool does instead of asking that tool.*

  It also now distinguishes *"collected by a CI gate"* from *"collected by a gate no CI job runs"* — `test:integration` needs live credentials and CI never invokes it, so counting it as coverage overstated what is actually guarded.

- **A shared mock helper cannot register its own `vi.mock`.** The helper now throws at import if `execute` is not a mock function, so a test that imports it without registering `vi.mock` fails loudly instead of silently exercising the real `gws` binary.
- Vitest is a smaller ecosystem than Jest. No Jest-specific plugins are in use here.

### Neutral

- Test count is unchanged: **691 before, 691 after.** This is a runner swap, not a coverage change.
- The MCP `resources/list` and `resources/read` handlers have **zero test coverage**. This predates and is unchanged by this ADR, but the review surfaced it and it should be filed.
- The `sanitize-html` pin stays exact until the Node floor rises (google-workspace-mcp#139).

## Evidence

Prototyped on `spike/vitest`, then reviewed adversarially. Measured, not asserted:

| | Jest (before) | Vitest (after) |
|---|---|---|
| Suites / tests | 38 / 691 passing | **38 / 691 passing** |
| `sanitize-html` | pinned `2.17.5` | **pinned `2.17.5`** (unchanged — see Context) |
| Production vulns | 0 | **0** |
| Dev vulns | 12 (1 critical) | **10 (0 critical)** |
| devDependencies | 8 | **6** |
| `make check` | passes | **passes** |

Unit suite verified network- and credential-free: 681/681 with an empty credential home.

Migration cost: ~30 files converted mechanically (`jest.` → `vi.`); three required human judgment, listed under Negative.

### The guards, and the probe that proves each one fires

A guard nobody has tried to defeat is a comment. Every check this ADR adds was **falsified** — the failure it claims to catch was injected, and the guard was confirmed to go red:

This table is the *current* result of re-running every probe. An earlier version of it asserted four passing rows when only two held — the table written to prove the guards fire was itself unfalsified. Treat a row here as a claim that must be re-run, not as history.

| Guard | Injected failure | Result |
|---|---|---|
| `scripts/check-test-gates.mjs` | `.test.ts` in a gate dir but outside `__tests__` | exit 1 |
| | untracked (unstaged) orphan test | exit 1 |
| | `.spec.ts` — never matched by vitest's `include` | exit 1 |
| | orphan outside every gate dir | exit 1 |
| | **orphan outside `src/` entirely** (`scripts/__tests__/`) | exit 1 — *passed green until round 5* |
| | **orphan in `src/coverage/`** (basename skip-list collision) | exit 1 — *passed green until round 5* |
| | real `- run: npm test` step deleted from ci.yml, comments left | no longer claims CI coverage — *reported it until round 5* |
| `type-check` CI job | type error in a test file | exit 1 |
| executor mock helper | `vi.mock` removed from a consuming test | throws at import |
| `scripts/check-build.mjs` (postbuild) | 6 of 7 service manifests deleted from `build/` | exit 1 |
| | `src/factory/manifest` missing / unreadable | exit 1, curated error (was: raw `node:fs` stack trace) |
| | built manifest present but loader cannot resolve it | exit 1 |
| `scripts/smoke-start.mjs` (`engines-floor` CI job) | `sanitize-html@2.17.6` on the advertised Node floor | `ERR_REQUIRE_ESM`, exit 1 |
| manifest resolution | `build/factory/manifest` removed | throws at startup (previously: silently rescued from `src/`) |

The last two are the ones that matter most, because they are the two that a green suite, a green `make check`, and green CI all previously reported as fine.

### Why there were five review rounds

Each adversarial review round found a real defect, and **every round of fixes introduced a fresh instance of the same pattern**: *a check that reports success while measuring the wrong thing.* Five for five.

1. Jest reporting `456 passed, 0 failed` while 222 tests had stopped running (the reason for this ADR).
2. A `sanitize-html` bump that passed the suite and all of CI while being a guaranteed startup crash for every Node 18 consumer.
3. A `tsconfig.test.json` type-check guard asserted in a commit message to be preserved — which **nothing invoked**.
4. The orphan-test guard written to fix (3), which measured directory prefixes instead of what vitest collects.
5. The rewrite of that guard, which asked vitest what it collects — but compared the answer against a file list of its own devising, narrower than vitest's in two independent ways. Plus the CI-invocation flag that answered "does anything actually run this?" by grepping the workflow file's *comments*. And a falsification table in this ADR claiming four passing probes when two of them failed.

Severity fell monotonically (production crash → shipped artifact defect → missing guard → dead-test hole → dead-test hole), but the *shape* never changed. That is the finding worth keeping: **in this codebase the recurring bug is not in the code under test, it is in the instrument.** Reviews that ask "is this code correct?" do not find it; the only thing that ever did was injecting the failure a check claims to catch and confirming the check goes red.

Both halves of the countermeasure are mechanical, and both are load-bearing:

- **Ask the tool; never re-derive what it does.** Every instance above came from re-implementing another tool's behavior — Jest's collection semantics, vitest's `include` glob, the loader's manifest enumeration, CI's invocation list — and getting it subtly narrower than the real thing. Hence: `check-test-gates` calls `vitest list`, `check-build` imports the real `loadManifest()`, `make build` delegates to `npm run build`, the CI flag parses `run:` steps, and the Node floor is *executed* rather than declared.
- **A guard nobody has tried to defeat is a comment.** Round 5 exists because round 4's guard was reviewed rather than attacked. The falsification table above is the standing obligation: every row must be re-run, not remembered.

## Alternatives Considered

**Jest with real ESM** (`--experimental-vm-modules` + `unstable_mockModule`). Honors the config's stated intent, but `jest.mock` does not work under ESM: it depends on CJS hoisting. The ESM path requires converting each module-under-test to a dynamic `await import()`, restructuring the imports of **18 of 33 test files** — and landing the whole suite on an API Jest itself labels `unstable_`, behind an experimental Node flag. Strictly more invasive than Vitest, for a worse endpoint.

**Stay on CJS deliberately.** Drop the ESM pretence, add `babel-jest` for `node_modules` and allowlist ESM-only transitives in `transformIgnorePatterns`. Config-only; touches no test files. Rejected: it entrenches a CJS test runner under an ESM codebase, so the production `setModuleDir()` shim stays forever, tests keep mocking `registry.js` to dodge the runner, and every future ESM-only dependency re-runs this exercise. It treats the symptom.

**Do nothing.** Rejected: the suite-load-failure blind spot (222 tests silently not running while the report read green) is on its own sufficient reason to move, independent of any dependency.
