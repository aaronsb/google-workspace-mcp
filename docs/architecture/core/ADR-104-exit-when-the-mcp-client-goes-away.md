---
status: Draft
date: 2026-07-16
deciders:
  - aaronsb
related: [ADR-102]
---

# ADR-104: Exit when the MCP client goes away

## Context

A stdio MCP server has no lifecycle of its own. It is spawned by a client, it serves that
client, and when that client is gone it has no reason to exist and no way to be useful —
its only channel to the world is a socket whose peer is dead. Nothing in this codebase
said so. The server had no notion that it could be orphaned, so it never exited.

Issue #149 reported the consequence: after a Claude Code session dies uncleanly, the
server process survives, reparents to init, and pegs one CPU core **indefinitely**. The
reporter found two orphans that had each burned 31 minutes of CPU in 31 minutes of wall
time. This is a user-visible defect of the worst kind — a background process, invisible,
draining a laptop battery, that the user never started and cannot attribute to us.

Two independent defects compound to produce it.

**The server never notices the client died.** No transport `onclose`, no stdin handling,
no liveness check. When the client vanishes the server keeps running.

**The crash guard becomes a busy-loop once stdio is dead.** `index.ts` installed:

```js
process.on('uncaughtException', (err) => {
  process.stderr.write(`[google-workspace-mcp] uncaught exception: ...`);
});
```

Once the peer is dead, a write to stderr raises an asynchronous error. That error reaches
the `uncaughtException` handler, which writes to the same dead stderr, which raises the
next error, which reaches the handler again — forever. The handler swallows every
exception (so the process never dies) while generating the next one. It is a perpetual
motion machine built out of error handling. The reporter's `sample(1)` puts ~70% of time
in `ErrorUtils::GetFormattedStack`: the process is spending its life formatting stack
traces for errors caused by reporting the previous error.

### What we measured

The report's diagnosis was correct; two of its load-bearing claims were not, and both
would have led us to a fix that didn't work. We reproduced the failure against a real
`socketpair()` — Claude Code wires stdio to unix sockets, not pipes, and this distinction
turned out to matter — under two scenarios:

- **A**: the socket peer dies, the parent process stays alive.
- **B**: the client is `SIGKILL`ed, orphaning the server (the reported scenario).

| Candidate | A: peer dies, parent lives | B: client SIGKILLed |
|---|---|---|
| Current code | **101% CPU, forever** | **101% CPU, forever** |
| Safe crash guard only | 0% CPU, process leaks | 0% CPU, process leaks |
| Orphan watchdog only | **101% CPU, forever** | exits in ~0.1s |

**The report's claim that "either bug alone would prevent the CPU spin" is false.** The
watchdog alone still spins in scenario A, because the parent is alive and the watchdog
never fires. The guard alone stops the spin but leaves an idle orphan forever. Each fix
has a gap the other covers, so we take both.

**The report's suggested watchdog is also subtly broken:**

```js
setInterval(() => { try { process.kill(process.ppid, 0); } catch { process.exit(0); } }, 5000)
```

`process.ppid` is a *live getter*, not a value cached at startup. Once the parent dies the
process is reparented and `process.ppid` becomes init/systemd — which is always alive, so
`process.kill(process.ppid, 0)` always succeeds and the check never fires. Verified
directly: after the parent died, `ppid` moved from `2884591` to `2951` (systemd), and
`kill(2951, 0)` reports alive. The original ppid must be captured at startup.

Finally, the report states that waiting for stdin EOF "would not be enough" because unix
sockets never surface EOF. On Linux we measured the opposite: `end` and `close` both fire
in scenarios A and B. We suspect the reporter's macOS observation is real but differently
caused — if the socket fd is still held open by another live process, no FIN is sent and
no EOF arrives. So EOF is a *useful* signal but not a *sufficient* one. It is fast and
clean when it comes; we use it, but we do not depend on it.

### Why nobody here ever saw this

Worth recording, because it shaped the tests. Orphan the *real* server on Linux over a
socketpair and it exits on its own — not from any lifecycle handling, but because stdin
EOF arrives, the transport stops reading, the event loop empties, and Node exits. The bug
is invisible on the platform we develop and test on.

It bites only where EOF never comes. There, stdin holds the loop open forever, the server
sits idle — and the moment anything logs, the write to the dead peer starts the busy-loop.
That is the reporter's macOS environment, and it is why the CPU spin and the process leak
are the same bug wearing two faces.

This has a direct consequence for testing: an orphan test that lets EOF arrive **passes
with the watchdog deleted**, because EOF alone reclaims the process. It would be a guard
reporting on a signal that was never the one under test. `scripts/smoke-orphan.mjs`
therefore builds a stdin that never reports EOF (a FIFO this project holds open) so that
only the watchdog can save the process. Verified to fail against the pre-fix entrypoint.

## Decision

**A stdio server exits when its client is gone.** We adopt this as policy, and implement
it as three layers in `src/lifecycle.ts`. Each layer independently prevents the 100% CPU
spin, and each covers a gap in the others.

**1. Crash guards that cannot re-enter.** Log with `writeSync(2, …)` inside `try/catch`.
Synchronous writes fail *here*, where the failure is caught, instead of surfacing later as
the next `uncaughtException`. This structurally forecloses the loop: the handler can no
longer generate the exception that re-invokes it. This mirrors `node-floor.ts`, which
already uses `writeSync` for a related reason (ADR-102).

The guard **swallows** a failed write; it does not exit. Exiting is the watchdog's single
responsibility. Inferring client death from a write error would also fire on a stderr
redirect gone bad, which is not the same thing and should not kill the server.

**2. An orphan watchdog.** Capture `process.ppid` at startup; poll every 5s on an
`unref()`ed timer. Treat the server as orphaned when the ppid *changes* (definitive
reparenting on Unix) **or** when the original ppid no longer exists. The
ppid-changed check is immune to PID reuse; the `kill(pid, 0)` check covers platforms that
do not reparent. Either signal means exit(0).

**3. Client-disconnect handlers.** Exit on stdin `end`/`close`. Fastest and cleanest
signal when the OS delivers it — typically sub-millisecond versus up to 5s for the
watchdog poll.

Layers 2 and 3 exit `0`. An orphaned server exiting is correct behavior, not a failure.

The decision logic is a pure function (`isOrphaned`) so it can be unit tested without
spawning processes — the same reasoning that split `node-floor.ts` out of the entrypoint
(ADR-102): logic that lives inline in `index.ts` is logic nothing can test, and this
project has already been bitten once by exactly that.

## Consequences

### Positive

- The reported defect is fixed at the root: orphans exit within 5s instead of burning a
  core forever.
- The busy-loop is structurally impossible, not merely unlikely. Even if a future change
  reintroduces a stdio-write crash, the guard cannot amplify it into a spin.
- Defense in depth: the fix survives the failure of any single layer, including layers
  whose behavior we know varies by platform (EOF delivery).
- `isOrphaned` is unit-testable, so the policy is protected by tests rather than by
  comments.

### Negative

- A 5s polling timer runs for the life of the process. It is `unref()`ed and does two
  integer comparisons per tick; the cost is negligible next to a pegged core.
- The server can now terminate itself. A bug in `isOrphaned` could kill a live server —
  which is why the predicate is pure and directly tested.
- Three layers to understand where there were none. Justified by the measured fact that no
  single layer covers both scenarios.

### Neutral

- Scenario A (peer dead, parent alive) leaves an *idle* process rather than exiting. It
  burns nothing, and stdin EOF or the watchdog reclaims it in every case we could
  construct. Not worth a fourth mechanism.
- If a future transport (HTTP) is added, layers 2 and 3 are stdio-specific and must not be
  installed for it.

## Alternatives Considered

- **Fix only the crash guard.** Rejected: stops the spin but leaks an idle orphan forever,
  and the process leak is half of what #149 reports.
- **Fix only the watchdog.** Rejected: measured to still spin at 101% in scenario A, and
  leaves the busy-loop primitive in place for any future stdio-write crash.
- **The report's `kill(process.ppid, 0)` snippet as written.** Rejected: measured not to
  work — `ppid` is a live getter and reads as init after reparenting.
- **Exit when the log write fails (reporter's alternative).** Rejected: conflates "stderr
  is broken" with "the client is gone." A misconfigured redirect would kill a healthy
  server. Kept exit under the watchdog, which tests the actual question.
- **Transport `onclose` via the SDK.** Deferred: it is a fourth signal for the same event,
  layered on an SDK abstraction whose orphan-time behavior we would have to characterize.
  The three layers here are measured; this would be assumed. Revisit if a gap appears.
- **An external watchdog wrapper** (the reporter's stopgap). Rejected as a shipped fix:
  pushes our lifecycle bug onto every user's process supervisor. A server that cannot
  clean up after itself is not fixed by asking users to clean up after it.
