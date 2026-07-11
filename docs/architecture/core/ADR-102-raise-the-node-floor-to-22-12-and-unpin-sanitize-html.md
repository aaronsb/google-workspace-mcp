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

Stated precisely, because an earlier draft of this ADR got it wrong: **Node 22 is in *Maintenance* LTS** — Node 24 took over the Active LTS line in October 2025. Node 22 receives security and critical fixes until **April 2027**, roughly nine months from this decision. So 22.12 is *supported*, not *current*: it is the lowest floor that is simultaneously (a) able to `require()` ESM unflagged and (b) still receiving fixes. That is the honest characterisation, and it means the next floor bump is a question for early 2027, not 2029.

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
- **An unsupported runtime produces a sentence, not a stack trace.** Verified against the real failure mode: with the floor set above the running Node *and* the `ERR_REQUIRE_ESM` condition active simultaneously, our message wins the race — the guard runs before the import that would throw. The message is written with `fs.writeSync(2, …)` rather than `process.stderr.write`, because Node's writes to a *pipe* are asynchronous on **macOS** — and Claude Desktop spawns the `.mcpb` server with piped stdio on the platform where `.mcpb` matters most. `process.stderr.write` followed immediately by `process.exit(1)` can tear the process down before the buffer drains, leaving the user a bare exit code and no message at all: strictly worse than the stack trace we were replacing.
- **We ship onto a supported runtime.** Node 22 receives fixes until April 2027, versus a floor that was already EOL.
- **The `.mcpb` bundle is now explicitly ESM.** It previously shipped with *no* `package.json`, so nothing declared `"type": "module"` and the entrypoint only parsed because Node's module-syntax *detection* is default-on from 20.19/22.7. On any host without it, the built entry died with a raw `SyntaxError` — meaning the startup guard could not run **in the one delivery channel it exists for**. The bundle now ships `{"type": "module"}`, and `compatibility.runtimes.node` tells the host the floor before it ever launches the server.
- **The bundle installs from the lockfile.** `make mcpb` used `npm install --production` with no lockfile, so with `sanitize-html` unpinned to `^2.17.6` the bundle could ship a version CI never validated — and `2.17.6` is itself the precedent for a patch bump swapping in a transitive with a new Node requirement. It now uses `npm ci --omit=dev`.

### Negative

- **This is a breaking change for consumers on Node 18 or 20.** It warrants a minor version bump and a release note. The mitigation is that they get a clear instruction rather than a crash — but they are still blocked until they upgrade.
- **The `.mcpb` break is narrower than it first appears — and an earlier draft of this ADR overstated it.** That draft called the host's Node "the main risk… not fully knowable from here." Investigating rather than speculating showed the bundle *could never have run below ~20.19 anyway*: it ships no `package.json`, so its ESM entrypoint only parsed at all thanks to Node's module-syntax detection, which is default-on from 20.19/22.7. Any `.mcpb` user on Node 18 was already broken, silently. The real exposure is hosts on **20.19–22.11**, who move from a working server to a clear "upgrade Node" message. Still a hard stop; a much smaller and better-understood one.
- **The floor still cannot be *tested* against a real Claude Desktop.** `compatibility.runtimes.node` should stop the host installing onto an inadequate runtime, but that depends on the host honoring the field, which is **unverified**. The startup guard is the backstop for every case it does not. Validate against a real `.mcpb` install before release.
- The floor is now written in four files. That is more places to drift — which is exactly why `check-node-floor` fails the build when they do.

### Neutral

- CI now runs Node 22 across all jobs (was 20), with the `engines-floor` job pinned to exactly `22.12.0`.
- Test count unchanged. No runtime behavior changes beyond the version guard.

## Evidence

### What the guards were missing

A review round on the first version of this change found that **the new guards attested to properties they never measured** — the recurring defect of this codebase, arriving for the sixth time. Specifically:

`check-node-floor` verified that `MIN_NODE` *exists and has the right value*. But the load-bearing property of `src/index.ts` is not the value of a constant — it is that the server is reached via `await import()` **after** the check. Revert that one line to a static `import` and the `ERR_REQUIRE_ESM` crash returns, while `check-node-floor`, typecheck, lint, all 681 tests and every CI job stay green — because every runtime in CI is *above* the floor, where the crash cannot occur. The only thing defending it was a code comment saying "do not tidy this into a static import."

**A comment is not a guard.** The fix is one behavioral test: run the built entrypoint on a Node *below* the floor and assert it exits non-zero, prints our message, and never leaks `ERR_REQUIRE_ESM` (`scripts/smoke-reject.mjs`, `engines-floor-reject` CI job). It refuses to run *above* the floor, so it cannot pass vacuously. `engines-floor` proves the server starts above the floor; `engines-floor-reject` proves it refuses below it. Neither is meaningful without the other.

### Falsified, not asserted

| Guard | Injected failure | Result |
|---|---|---|
| `smoke-reject.mjs` | **`await import()` reverted to a static import** | exit 1 — "ERR_REQUIRE_ESM leaked… someone turned the `await import()` back into a static import" |
| | run above the floor (where it would prove nothing) | refuses to run |
| `check-node-floor.mjs` | static import of the server graph in `src/index.ts` | exit 1 |
| | `engines.node` raised, other sites left behind | exit 1, names all four |
| | floor pin **commented out** in ci.yml | exit 1 *(used to report "executed in CI" — comments were matched as if live)* |
| | `smoke-start` step deleted from `engines-floor` | exit 1 *(used to stay green: it checked a version string, not that anything ran)* |
| | `engines-floor-reject` job deleted | exit 1 |
| startup guard | floor above running Node, **with `ERR_REQUIRE_ESM` active** | our message, exit 1 — `ERR_REQUIRE_ESM` never printed |
| | `22.12.0-rc.1` (pre-release of the floor) | rejected — *used to be waved through as "equal"* |
| `.mcpb` bundle | run with module-syntax detection disabled | starts; guard fires and prints the message *(previously: raw `SyntaxError`, guard never ran)* |

`npm audit --omit=dev` after the unpin: **0 vulnerabilities**. `sanitize-html@2.17.6`, `htmlparser2@12.0.0`. Unit suite: 681/681 — passing with a pure-ESM transitive, which is ADR-101 arriving.

## Alternatives Considered

**Floor at `>=20.19` (what issue #139 proposed).** The minimum that unblocks the pin, and the smallest break for consumers. Rejected: Node 20 went EOL in April 2026, so this ships onto an unsupported runtime and schedules the same migration again within the year. The consumer breakage is nearly identical (anyone below 20.19 breaks either way); the difference is whether the destination is supported.

**Leave the pin, don't raise the floor.** Genuinely tenable: 2.17.5 is *not* vulnerable, so the pin costs nothing today except the ability to take future patches. Rejected because the cost is not static — the pin blocks every future `sanitize-html` patch including the next security one, and we would be making this decision under time pressure instead of calmly. Doing it now, with the `engines-floor` guard already built and green, is the cheap moment.

**Declare the floor only in `mcpb/manifest.json` (`compatibility.runtimes.node`) and let the host refuse the install.** Cleaner in principle, but it relies on the host honoring the field — which has *not* been verified — and does nothing for `npx` users. The startup guard covers every case, including hosts that ignore the manifest. Adding the manifest declaration as well remains worthwhile and is left as follow-up.
