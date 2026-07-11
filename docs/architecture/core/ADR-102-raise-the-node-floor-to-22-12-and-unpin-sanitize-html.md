---
status: Draft
date: 2026-07-11
deciders:
  - aaronsb
related: [ADR-101]
---

# ADR-102: Raise the Node floor to 22.12 and unpin sanitize-html

## Context

`sanitize-html` is pinned to **exactly `2.17.5`**. The pin is not a security measure — 2.17.5 carries the fix for GHSA-rpr9-rxv7-x643, whose vulnerable range is 2.17.3 alone. The pin exists because we *cannot take the next patch*:

`sanitize-html` 2.17.6 moves to the pure-ESM `htmlparser2@12`. `sanitize-html` is itself **CommonJS** (`index.js:1` is `require('htmlparser2')`), and a CJS `require()` of an ESM-only package only resolves unflagged on Node **≥20.19 / ≥22.12**. It is a static import in the startup graph (`markdown.ts` → `html-sanitize.ts`), so on an older Node the server does not degrade — it fails to boot, with `ERR_REQUIRE_ESM` thrown from inside somebody else's `node_modules`.

That is not hypothetical. This exact bump reached a merge-ready branch during ADR-101, passing the full test suite and every CI job, because the dev box ran Node 26 and CI pinned Node 20. It would have crashed **every Node 18 consumer on first start**. The `engines-floor` CI job built during ADR-101 exists precisely to make that impossible: it runs the built server on the declared floor against the production dependency tree. It is what makes this ADR safe to execute.

So the floor is the whole question. Two numbers are available, and they are no longer the same:

- **≥20.19** — the *minimum that works*. The lowest Node with unflagged `require(ESM)`.
- **≥22.12** — the *minimum that is supported*. Node 22 is Active LTS until April 2027.

It is July 2026. **Node 18 reached end-of-life in April 2025, and Node 20 in April 2026.** Declaring `>=20.19` today would mean advertising a floor that is *already out of support* on the day it ships, and doing this exercise again within the year.

### The floor is not just an npm field

`engines.node` is advisory: npm warns, it does not block. And the `.mcpb` bundle does not consult it at all — `mcpb/manifest.json` runs a bare `node`, meaning **the host's runtime**, whose version we neither control nor can test in CI. A floor that exists only in `package.json` is a floor that protects nobody.

## Decision

**Raise the floor to Node `>=22.12.0`, unpin `sanitize-html` to `^2.17.6`, and enforce the floor in three places that must agree.**

The two-floor model from ADR-101 (consumers on 18.14.1, contributors on 20.19 for Vitest) is **collapsed into one number**. Conflating those two floors is what produced the original crash; keeping them separate invites the same confusion back. One number, checked three ways:

| Where | What it does |
|---|---|
| `engines.node` in `package.json` | what npm tells a consumer at install time (advisory) |
| the `engines-floor` CI job | **executes** the built server on exactly that Node, production deps only |
| `MIN_NODE` in `src/index.ts` | startup guard — a readable error instead of `ERR_REQUIRE_ESM` |

The startup guard is the only defence the `.mcpb` bundle has. `src/index.ts` therefore imports **nothing** from the server graph at module scope: ESM evaluates static imports before the importing module's body, so a static `import { startServer }` would pull in `sanitize-html` — and crash — *before* any check in that file could run. The version check runs first; the server is loaded by dynamic `import()` only once the runtime is known to be adequate. This is the one place in the codebase where import style is load-bearing.

A comment reading "keep these in sync" is a coupling maintained by nobody, so `scripts/check-node-floor.mjs` fails the build if the three ever disagree, or if the `engines-floor` job disappears entirely.

## Consequences

### Positive

- **The `sanitize-html` pin is gone.** Future patches can be taken normally. Production vulnerabilities remain **0**.
- **The floor we publish is the floor we execute.** Raising it in one place and forgetting the others is now a build failure, not a latent crash.
- **An unsupported runtime produces a sentence, not a stack trace.** Verified against the real failure mode: with the floor set above the running Node *and* the `ERR_REQUIRE_ESM` condition active simultaneously, our message wins the race — the guard runs before the import that would throw.
- **We ship onto a supported runtime.** Node 22 is Active LTS until April 2027, versus a floor that was already EOL.

### Negative

- **This is a breaking change for consumers on Node 18 or 20**, and therefore for the `.mcpb` bundle if the host's Node is older than 22.12. It warrants a minor version bump and a release note. The mitigation is that they get a clear instruction rather than a crash — but they are still blocked until they upgrade.
- **`.mcpb` risk is real and not fully knowable from here.** The bundle runs the host's Node. If Claude Desktop ships a runtime below 22.12, `.mcpb` users will hit the startup guard. That is strictly better than `ERR_REQUIRE_ESM`, but it is still a hard stop, and we cannot test it in CI. **This is the main risk of this ADR and should be validated against a real `.mcpb` install before release.**
- The floor is now written in three files. That is more places to change — which is exactly why it is checked.

### Neutral

- CI now runs Node 22 across all jobs (was 20), with the `engines-floor` job pinned to exactly `22.12.0`.
- Test count unchanged. No runtime behavior changes beyond the version guard.

## Evidence

Falsified, not asserted. Each guard was made to fail on purpose:

| Guard | Injected failure | Result |
|---|---|---|
| `check-node-floor.mjs` | `engines.node` raised, CI + startup guard left behind | exit 1, names all three |
| | `engines-floor` CI job left on the old Node | exit 1 |
| | `MIN_NODE` not updated | exit 1 |
| | `engines-floor` job deleted entirely | exit 1 |
| startup guard (`src/index.ts`) | floor set above the running Node, **with `ERR_REQUIRE_ESM` active** | our message, exit 1 — `ERR_REQUIRE_ESM` never printed |
| `engines-floor` CI job | (standing) runs the built server on 22.12.0, prod deps only | handshake + tools loaded |

`npm audit --omit=dev` after the unpin: **0 vulnerabilities**. `sanitize-html@2.17.6`, `htmlparser2@12.0.0`.

## Alternatives Considered

**Floor at `>=20.19` (what issue #139 proposed).** The minimum that unblocks the pin, and the smallest break for consumers. Rejected: Node 20 went EOL in April 2026, so this ships onto an unsupported runtime and schedules the same migration again within the year. The consumer breakage is nearly identical (anyone below 20.19 breaks either way); the difference is whether the destination is supported.

**Leave the pin, don't raise the floor.** Genuinely tenable: 2.17.5 is *not* vulnerable, so the pin costs nothing today except the ability to take future patches. Rejected because the cost is not static — the pin blocks every future `sanitize-html` patch including the next security one, and we would be making this decision under time pressure instead of calmly. Doing it now, with the `engines-floor` guard already built and green, is the cheap moment.

**Declare the floor only in `mcpb/manifest.json` (`compatibility.runtimes.node`) and let the host refuse the install.** Cleaner in principle, but it relies on the host honoring the field — which has *not* been verified — and does nothing for `npx` users. The startup guard covers every case, including hosts that ignore the manifest. Adding the manifest declaration as well remains worthwhile and is left as follow-up.
