#!/usr/bin/env node
/**
 * Asserts an ORPHANED server exits instead of pegging a CPU core (issue #149, ADR-104).
 *
 * The reported failure: a Claude Code session dies uncleanly, the server reparents to
 * init, and burns 100% of a core forever — two orphans had each eaten 31 minutes of CPU in
 * 31 minutes of wall time. The unit tests cover `isOrphaned` as a predicate; nothing there
 * proves a real process tree actually reclaims itself, which is the only claim a user
 * cares about.
 *
 * This runs the HARD case on purpose. The easy orphan reclaims itself via stdin EOF, so a
 * naive test passes even with the watchdog deleted. So we build a stdin that NEVER reports
 * EOF and let only the watchdog save us:
 *
 *     smoke (this)          holds the FIFO open for writing, and stays alive
 *       └── intermediate    stands in for Claude Code; SIGKILLed
 *             └── server    stdin = the FIFO's read end
 *
 * When the intermediate is killed, the server is orphaned — but its stdin still has a live
 * writer (us), so no EOF ever arrives. That models the macOS report, where the client's
 * socket fd is held open elsewhere and EOF never comes. If the watchdog regresses, this
 * hangs and fails rather than passing on a signal that wasn't there.
 *
 * Deliberately dependency-free and ES2021-plain, matching the other smoke scripts.
 * POSIX-only (FIFOs, SIGKILL, reparenting); skipped on Windows.
 */
import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, mkdtempSync, rmSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'build/index.js');

// The watchdog polls every 5s; allow a few cycles before calling it a failure.
const DEADLINE_MS = 20_000;

if (process.platform === 'win32') {
  console.log('smoke-orphan: SKIP — POSIX-only (FIFOs, SIGKILL, reparenting)');
  process.exit(0);
}

const fail = (msg, extra) => {
  console.error(`smoke-orphan: FAIL — ${msg}`);
  if (extra) console.error(String(extra).trim());
  process.exit(1);
};

const dir = mkdtempSync(join(tmpdir(), 'smoke-orphan-'));
const fifo = join(dir, 'stdin.fifo');
let fifoFd = null;
let intermediate = null;
let serverPid = null;

const cleanup = () => {
  for (const pid of [serverPid, intermediate?.pid]) {
    try { if (pid) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  try { if (fifoFd !== null) closeSync(fifoFd); } catch { /* already closed */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
};
process.on('exit', cleanup);

if (spawnSync('mkfifo', [fifo]).status !== 0) fail('could not create a FIFO');

// O_RDWR, not O_WRONLY: opening a FIFO write-only BLOCKS until a reader arrives, and the
// reader is a process we have not spawned yet — a deadlock. O_RDWR never blocks, and holds
// the write end open for as long as we live, which is the entire point of this test.
fifoFd = openSync(fifo, constants.O_RDWR);

// The intermediate stands in for the MCP client: it spawns the server on the FIFO, reports
// the pid, and then does nothing until it is killed.
const intermediateSrc = `
  import { spawn } from 'node:child_process';
  import { openSync } from 'node:fs';
  const stdin = openSync(${JSON.stringify(fifo)}, 'r');
  const child = spawn(process.execPath, [${JSON.stringify(ENTRY)}], {
    cwd: '/',
    stdio: [stdin, 'ignore', 'ignore'],
    env: { ...process.env, GOOGLE_CLIENT_ID: 'smoke.invalid', GOOGLE_CLIENT_SECRET: 'smoke' },
  });
  process.stdout.write(child.pid + '\\n');
  setInterval(() => {}, 1000);
`;

intermediate = spawn(process.execPath, ['--input-type=module', '-e', intermediateSrc], {
  stdio: ['ignore', 'pipe', 'inherit'],
});

/**
 * Whether OUR server is still running as `pid`.
 *
 * Identity-checked, not just `kill(pid, 0)`. Once the intermediate is dead the server is
 * reparented to init, so we cannot `waitpid` it and can only ask about a bare pid — and a
 * bare pid is not a stable identity. The kernel is free to hand that number to an
 * unrelated process the moment the server exits, and CI is exactly where that churn
 * happens. `kill(pid, 0)` alone would then report "still alive", failing the build for a
 * server that had already done the right thing. (Observed during development: a reused pid
 * masqueraded as a live orphan sitting at 0% CPU.)
 *
 * So: confirm the command line is still ours. Wrong process, or no process, means our
 * server is gone — which is the outcome this test is asking about.
 */
const alive = (pid) => {
  const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (ps.status !== 0) return false; // no such pid
  return ps.stdout.includes(ENTRY);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

intermediate.stdout.on('data', (chunk) => {
  if (serverPid) return;
  serverPid = Number(String(chunk).trim());
  if (!Number.isInteger(serverPid) || serverPid <= 0) fail(`bad server pid: ${chunk}`);
  run();
});

intermediate.on('error', (err) => fail(`could not spawn the intermediate: ${err.message}`));

async function run() {
  // Let the server finish starting, so we are killing a live server rather than racing it.
  await sleep(3000);
  if (!alive(serverPid)) fail(`server ${serverPid} died before the test began`);

  // The client dies uncleanly: no cleanup, no clean shutdown, no chance to kill us.
  process.kill(intermediate.pid, 'SIGKILL');

  const started = Date.now();
  while (Date.now() - started < DEADLINE_MS) {
    if (!alive(serverPid)) {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `smoke-orphan: OK — orphaned server exited on its own after ${secs}s ` +
          `(no EOF available; watchdog reclaimed it, node ${process.version})`,
      );
      process.exit(0);
    }
    await sleep(250);
  }

  fail(
    `orphaned server ${serverPid} was STILL ALIVE ${DEADLINE_MS / 1000}s after its client ` +
      `was killed. This is issue #149: it will burn a CPU core until the user finds it.`,
  );
}
