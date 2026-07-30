/**
 * Tests for the orphan-detection lifecycle (issue #149, ADR-104).
 *
 * These exist because the server can now TERMINATE ITSELF. A bug in `isOrphaned` would not
 * produce a wrong answer somewhere — it would kill a live server mid-request, or fail to
 * reclaim the orphan this whole module exists to reclaim. That is why the predicate is
 * pure and tested directly rather than only through a spawned process tree.
 *
 * The end-to-end behavior (a real orphan, over a real unix socketpair, actually exiting
 * instead of pegging a core) is not testable here — it needs process trees and CPU
 * measurement. `scripts/smoke-orphan.mjs` covers that.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The guard logs with `writeSync(2, …)`, NOT `process.stderr.write` — that is the whole
 * point of it (a synchronous write fails where it can be caught, instead of surfacing as
 * the next uncaughtException). So the failure must be injected at `writeSync`. Spying on
 * `process.stderr.write` here would mock something the guard never calls, and the tests
 * would pass while exercising nothing.
 */
const writeSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeSync: writeSyncMock };
});

import { isOrphaned, installLifecycle, WATCHDOG_INTERVAL_MS } from '../../lifecycle.js';

describe('isOrphaned', () => {
  const PARENT = 1000;

  it('is false while the parent is unchanged and alive', () => {
    expect(isOrphaned(PARENT, PARENT, true)).toBe(false);
  });

  /**
   * The reported failure. On Unix a dead parent means immediate reparenting, so a CHANGED
   * ppid is definitive — and it is the signal that survives PID reuse.
   */
  it('is true when the ppid changed — reparented, so the parent is gone', () => {
    expect(isOrphaned(PARENT, 1, true)).toBe(true);
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * The fix suggested in #149 polls `process.kill(process.ppid, 0)` — re-reading ppid
   * every tick. After reparenting, ppid IS init/systemd, which is always alive, so that
   * check reports "parent alive" forever and the server spins on at 100% CPU.
   *
   * This asserts we key off the ORIGINAL ppid: reparented to init, and init is alive, is
   * still orphaned. If someone "simplifies" isOrphaned to trust parentAlive alone, this
   * fails — which is the entire point.
   */
  it('is true when reparented to init even though init is alive', () => {
    expect(isOrphaned(PARENT, 1, true)).toBe(true);
  });

  /** For platforms that don't reparent (Windows): the pid probe carries the signal. */
  it('is true when the ppid is unchanged but the parent no longer exists', () => {
    expect(isOrphaned(PARENT, PARENT, false)).toBe(true);
  });
});

describe('installLifecycle', () => {
  const stops: Array<() => void> = [];
  const install = (hooks: Parameters<typeof installLifecycle>[0]) => {
    const stop = installLifecycle(hooks);
    stops.push(stop);
    return stop;
  };

  afterEach(() => {
    while (stops.length) stops.pop()!();
    vi.useRealTimers();
    writeSyncMock.mockReset();
  });

  /** Fire the guard we just installed, the way an uncaught exception would. */
  const fireUncaught = (err: Error): void => {
    const handler = process.listeners('uncaughtException').at(-1) as (e: Error) => void;
    handler(err);
  };

  it('does not exit while the parent is alive', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    install({ exit, parentAlive: () => true });

    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS * 4);

    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 0 once the parent goes away', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    let alive = true;
    install({ exit, parentAlive: () => alive });

    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();

    alive = false;
    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS);

    // 0, not 1: an orphaned server exiting is correct behavior, not a failure.
    expect(exit).toHaveBeenCalledWith(0);
  });

  /**
   * Layer 1, the busy-loop guard. The old handler wrote to `process.stderr`, and once the
   * peer was dead that write raised the NEXT uncaughtException, which re-entered the
   * handler, forever, at 100% CPU.
   *
   * Simulating a dead stderr faithfully takes a real socketpair, so this asserts the
   * structural property instead: the handler must complete without throwing even when the
   * write fails. A handler that cannot throw cannot feed itself.
   */
  it('survives a crash report when the stderr write fails', () => {
    const exit = vi.fn();
    install({ exit, parentAlive: () => true });
    writeSyncMock.mockImplementation(() => {
      throw new Error('EPIPE: broken pipe');
    });

    expect(() => fireUncaught(new Error('boom'))).not.toThrow();
  });

  /**
   * The loop was fed by the handler re-attempting a doomed write. Once a write has failed,
   * stderr is latched dead and we stop trying — so a storm of exceptions cannot become a
   * storm of writes. This asserts the latch, not merely that try/catch caught something:
   * exactly ONE write is attempted across many exceptions.
   */
  it('stops attempting writes once stderr is known dead', () => {
    const exit = vi.fn();
    install({ exit, parentAlive: () => true });
    writeSyncMock.mockImplementation(() => {
      throw new Error('EPIPE: broken pipe');
    });

    for (let i = 0; i < 50; i++) fireUncaught(new Error(`boom ${i}`));

    expect(writeSyncMock).toHaveBeenCalledTimes(1);
  });

  /** A healthy server still reports its crashes. The guard must not silence everything. */
  it('logs crashes normally while stderr works', () => {
    const exit = vi.fn();
    install({ exit, parentAlive: () => true });
    writeSyncMock.mockReturnValue(undefined);

    fireUncaught(new Error('boom'));

    expect(writeSyncMock).toHaveBeenCalledTimes(1);
    expect(writeSyncMock.mock.calls[0][0]).toBe(2); // fd 2, stderr
    expect(String(writeSyncMock.mock.calls[0][1])).toContain('boom');
    expect(exit).not.toHaveBeenCalled();
  });

  /**
   * The reclaim that swallowing would cost us. A dead stderr is the EARLIEST signal we get
   * on macOS, where stdin EOF never arrives — so a write failure must trigger the liveness
   * check immediately rather than idling until the next 5s poll.
   */
  it('exits immediately on a failed write when the parent is already gone', () => {
    const exit = vi.fn();
    install({ exit, parentAlive: () => false });
    writeSyncMock.mockImplementation(() => {
      throw new Error('EPIPE: broken pipe');
    });

    fireUncaught(new Error('boom'));

    // No timer advance: reclaimed on the spot, not up to WATCHDOG_INTERVAL_MS later.
    expect(exit).toHaveBeenCalledWith(0);
  });

  /**
   * The guard treats a failed write as EVIDENCE, not a verdict.
   *
   * "stderr is broken" is not the same claim as "the client is gone" — a botched stderr
   * redirect says the same thing, and must not kill a healthy server. So a write failure
   * triggers a real liveness CHECK; only that check may exit.
   */
  it('does not exit on a failed write when the parent is still alive', () => {
    const exit = vi.fn();
    install({ exit, parentAlive: () => true });
    writeSyncMock.mockImplementation(() => {
      throw new Error('EPIPE: broken pipe');
    });

    fireUncaught(new Error('boom'));

    expect(exit).not.toHaveBeenCalled();
  });

  /** Layer 3: the fastest signal, when the OS delivers it. */
  it('exits 0 when stdin reports end-of-stream', () => {
    const exit = vi.fn();
    install({ exit, parentAlive: () => true });

    process.stdin.emit('end');

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('removes its listeners on stop, leaving no handlers behind', () => {
    const before = process.listenerCount('uncaughtException');
    const stop = installLifecycle({ exit: vi.fn(), parentAlive: () => true });
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);

    stop();
    stops.pop(); // already stopped

    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});
