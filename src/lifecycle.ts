/**
 * Process lifecycle for the stdio server: notice the client is gone, and exit.
 *
 * A stdio MCP server has no life of its own. It is spawned by a client, it speaks to that
 * client over stdin/stdout, and once that client is gone it can neither be useful nor be
 * noticed — its only channel to the world is a socket whose peer is dead. Nothing in this
 * codebase said so, so the server never exited. Issue #149: after a Claude Code session
 * died uncleanly, orphaned servers reparented to init and pegged a CPU core *forever* —
 * two of them had burned 31 minutes of CPU in 31 minutes of wall time.
 *
 * Two defects compounded. The server never noticed the client died (no signal was
 * watched), and the `uncaughtException` guard in index.ts became a perpetual motion
 * machine: it logged to stderr, and once the peer was dead that write raised the next
 * uncaught exception, which re-entered the handler, which wrote to the same dead stderr…
 * The handler swallowed every exception (so the process never died) while generating the
 * next one. ~70% of samples were in stack formatting — the process spent its life
 * formatting traces for errors caused by reporting the previous error.
 *
 * The fix is three layers. Each independently prevents the spin, and each covers a gap the
 * others have — this is measured, not assumed (see ADR-104 for the matrix):
 *
 *   1. Crash guards that cannot re-enter  (kills the busy-loop structurally)
 *   2. An orphan watchdog                 (reclaims the process; the only exit decision)
 *   3. stdin end/close                    (fastest signal, when the OS delivers it)
 *
 * Neither of the two obvious single-layer fixes is sufficient. The watchdog alone still
 * spins at 101% when the socket peer dies but the parent lives — the parent is alive, so
 * it never fires. The guard alone stops the spin but leaks an idle orphan forever.
 *
 * Split out of index.ts so it can be UNIT TESTED, for the same reason node-floor.ts was
 * (ADR-102): logic that lives inline in the entrypoint is logic nothing can test, and a
 * revert once slipped through `make check`, all tests, and every CI job because of exactly
 * that. `isOrphaned` is therefore a pure function, tested directly.
 *
 * Imports only `node:fs` (a builtin), so index.ts may import it statically without
 * tripping the ESM/CJS hazard the Node floor guards. See the index.ts header.
 */
import { writeSync } from 'node:fs';

/** How often to check whether our parent is still alive. */
export const WATCHDOG_INTERVAL_MS = 5000;

/**
 * Whether the process has been orphaned, given a startup ppid and what we see now.
 *
 * Pure so it can be tested without spawning process trees. Two signals, because neither
 * covers every platform:
 *
 * `currentPpid !== originalPpid` — on Unix a dead parent means immediate reparenting to
 * init/systemd, so a *changed* ppid is definitive. This is the reliable one, and it is
 * immune to PID reuse.
 *
 * `!parentAlive` — a `kill(pid, 0)` probe, for platforms that don't reparent (Windows).
 * Note this is checked against the ORIGINAL ppid, captured at startup.
 *
 * Why the original ppid matters: `process.ppid` is a LIVE GETTER, not a value fixed at
 * startup. The fix suggested in #149 polls `process.kill(process.ppid, 0)`, which re-reads
 * ppid every tick — after reparenting that reads as init/systemd, which is always alive,
 * so the check never fires and the server spins on. Measured: after the parent died, ppid
 * moved 2884591 -> 2951 (systemd), and kill(2951, 0) reports alive. Reading ppid once, at
 * startup, is the whole trick.
 */
export function isOrphaned(
  originalPpid: number,
  currentPpid: number,
  parentAlive: boolean
): boolean {
  return currentPpid !== originalPpid || !parentAlive;
}

/** Whether a pid exists. `kill(pid, 0)` sends no signal; it only probes. */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface LifecycleHooks {
  /** Seam for tests. Defaults to process.exit. */
  exit?: (code: number) => void;
  /** Seam for tests. Defaults to a real pid probe. */
  parentAlive?: (pid: number) => boolean;
}

/**
 * Installs all three layers. Call once, from the entrypoint, before starting the server.
 *
 * Returns a `stop()` for tests; the real process never needs it.
 */
export function installLifecycle(hooks: LifecycleHooks = {}): () => void {
  const exit = hooks.exit ?? ((code: number) => process.exit(code));
  const parentAlive = hooks.parentAlive ?? pidExists;

  // Read ONCE. See isOrphaned: re-reading this is the bug in the suggested fix.
  const originalPpid = process.ppid;

  // Latched once a write fails. Not just an optimisation: it stops us re-attempting
  // writes we know are doomed, rather than leaning on try/catch to swallow each one.
  let stdioDead = false;

  /**
   * The ONE place this process decides to die.
   *
   * Exit code 0: an orphaned server exiting is correct behavior, not a failure.
   */
  const checkOrphaned = (): void => {
    if (isOrphaned(originalPpid, process.ppid, parentAlive(originalPpid))) {
      exit(0);
    }
  };

  /**
   * Log that cannot start the loop it is reporting on.
   *
   * `writeSync`, NOT `process.stderr.write`: a synchronous write fails HERE, where it is
   * caught, instead of surfacing later as the next uncaughtException. That is what makes
   * the busy-loop structurally impossible rather than merely unlikely — the handler can no
   * longer generate the exception that re-invokes it. (node-floor.ts uses writeSync for a
   * related reason; see ADR-102.)
   *
   * A failed write is EVIDENCE, not a verdict. It means "stderr is broken", which is not
   * the same claim as "the client is gone" — a botched stderr redirect would say the same
   * thing, and must not kill a healthy server. So we don't exit here (as #149 suggests);
   * we ask the watchdog to test the real question, right now. When we are genuinely
   * orphaned that reclaims the process in ~0ms instead of waiting up to 5s for the next
   * poll — which is the difference that matters on macOS, where stdin EOF never arrives
   * and this is the earliest signal we get.
   */
  const safeLog = (msg: string): void => {
    if (stdioDead) return;
    try {
      writeSync(2, msg);
    } catch {
      stdioDead = true;
      checkOrphaned();
    }
  };

  // Layer 1: crash guards that cannot re-enter.
  const onUncaught = (err: Error): void => {
    safeLog(`[google-workspace-mcp] uncaught exception: ${err.message}\n${err.stack}\n`);
  };
  const onRejection = (reason: unknown): void => {
    safeLog(`[google-workspace-mcp] unhandled rejection: ${reason}\n`);
  };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);

  // Layer 2: the orphan watchdog. unref()'d so it never by itself keeps us alive.
  const timer = setInterval(checkOrphaned, WATCHDOG_INTERVAL_MS);
  timer.unref();

  // Layer 3: client disconnect. Fastest signal when the OS delivers it — sub-millisecond
  // versus up to WATCHDOG_INTERVAL_MS. #149 reports that unix sockets may never surface
  // EOF (macOS); we measured both `end` and `close` firing reliably on Linux. Likely the
  // fd is held open elsewhere there, so no FIN is sent. Hence: use it, don't depend on it.
  const onDisconnect = (): void => exit(0);
  // A dead peer surfaces as an error on stdin too; it must not become an uncaught one.
  const onStdinError = (): void => {
    stdioDead = true;
    checkOrphaned();
  };
  process.stdin.on('end', onDisconnect);
  process.stdin.on('close', onDisconnect);
  process.stdin.on('error', onStdinError);

  return () => {
    clearInterval(timer);
    process.stdin.off('end', onDisconnect);
    process.stdin.off('close', onDisconnect);
    process.stdin.off('error', onStdinError);
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onRejection);
  };
}
