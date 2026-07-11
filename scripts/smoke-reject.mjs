#!/usr/bin/env node
/**
 * Runs the BUILT entrypoint on a BELOW-FLOOR Node and asserts it rejects properly.
 *
 * This is the guard-for-the-guard, and it exists because every other check in this
 * repo verifies the startup guard's *spelling* rather than its *behavior*:
 *
 *   - `check-node-floor.mjs` confirms `MIN_NODE` has the right value.
 *   - `smoke-start.mjs` confirms the server starts ABOVE the floor.
 *   - Nothing confirmed the server REJECTS below it.
 *
 * So the load-bearing property was unprotected. `src/index.ts` reaches the server via
 * `await import()` *after* the version check, specifically so that `sanitize-html` →
 * `htmlparser2@12` is never evaluated on a runtime that cannot `require()` ESM. Revert
 * that one line to a static `import` and the guard silently stops running before the
 * crash it exists to prevent — while `check-node-floor`, typecheck, lint, all 681
 * tests, and every CI job stay green, because every runtime in CI is above the floor.
 * The only thing defending it was a code comment saying "do not tidy this into a
 * static import." A comment is not a guard.
 *
 * This script is that guard. Run it on a Node BELOW the floor. It asserts:
 *
 *   1. the process exits non-zero,
 *   2. our human-readable message appears,
 *   3. ERR_REQUIRE_ESM does NOT appear   — proves the guard ran BEFORE the import,
 *   4. no SyntaxError appears            — proves the file parsed as ESM at all
 *                                          (the .mcpb bundle ships no package.json,
 *                                          so this is a real failure mode).
 *
 * Usage: node scripts/smoke-reject.mjs [entrypoint]   (default: build/index.js)
 *        Must be executed by a Node older than the floor, or it self-skips loudly.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, 'build/index.js');

const MIN_NODE = /^export const MIN_NODE = '([^']+)'/m
  .exec(readFileSync(resolve(ROOT, 'src/node-floor.ts'), 'utf8'))?.[1];
if (!MIN_NODE) {
  console.error('smoke-reject: could not read MIN_NODE from src/node-floor.ts — the guard is gone.');
  process.exit(1);
}

const cmp = (a, b) => {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
};

if (cmp(process.versions.node, MIN_NODE) >= 0) {
  console.error(
    `smoke-reject: MUST run on a Node BELOW the floor (${MIN_NODE}), but this is ` +
    `${process.version}. Running it above the floor proves nothing — the guard would ` +
    `not fire. In CI this runs under an explicitly below-floor setup-node step.`,
  );
  process.exit(1);
}

const r = spawnSync(process.execPath, [ENTRY], {
  cwd: '/',                       // as npx / .mcpb do: cwd is not the project root
  encoding: 'utf8',
  input: '{}\n',
  timeout: 30_000,
  env: { ...process.env, GOOGLE_CLIENT_ID: 'smoke.invalid', GOOGLE_CLIENT_SECRET: 'smoke' },
});

const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
const fail = (why) => {
  console.error(`smoke-reject: FAIL — ${why}\n`);
  console.error(`  node:      ${process.version}  (floor is ${MIN_NODE})`);
  console.error(`  entry:     ${ENTRY}`);
  console.error(`  exit code: ${r.status}\n`);
  console.error(out.trim() || '  (no output at all)');
  process.exit(1);
};

// 4 — the file must PARSE. The .mcpb bundle ships without a package.json, so if the
// bundle is not explicitly ESM the entrypoint dies here and the guard never runs.
if (/SyntaxError|Cannot use import statement|await is only valid/.test(out)) {
  fail('the entrypoint failed to PARSE — the guard never ran. Is the bundle missing `"type": "module"`?');
}

// 3 — the guard must run BEFORE the server graph is imported. If this appears, the
// dynamic import was reverted to a static one and the crash is back.
if (/ERR_REQUIRE_ESM/.test(out)) {
  fail('ERR_REQUIRE_ESM leaked — the server graph was imported BEFORE the version check. ' +
       'Someone turned the `await import()` in src/index.ts back into a static import.');
}

// 1 — it must refuse to run.
if (r.status === 0) fail('the server started on a below-floor Node instead of refusing.');

// 2 — and it must say why, in words.
if (!out.includes(`requires Node >=${MIN_NODE}`)) {
  fail('exited non-zero but never printed the version message (dropped stderr? wrong message?).');
}

console.log(
  `smoke-reject: OK — on ${process.version} (below the ${MIN_NODE} floor) the server refused ` +
  `to start, explained why, and never leaked ERR_REQUIRE_ESM.`,
);
