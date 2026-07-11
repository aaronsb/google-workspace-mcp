#!/usr/bin/env node
/**
 * Fails if any test file on disk is run by no gate.
 *
 * `npm test` uses an allowlist of vetted, fully-mocked directories rather than a
 * denylist, so that a future network-touching test cannot auto-enrol itself into
 * the CI gate. The cost of an allowlist is the opposite failure: a test added
 * outside those directories is collected by no gate at all, runs nowhere, and
 * reports nothing — green CI, dead test.
 *
 * A comment promising "every test runs somewhere" is a claim. This is the check.
 *
 * The first version of this script *was itself* an instance of the bug it exists
 * to catch. It asked "is this file's path under a gate directory?" while vitest
 * asks "does this path match `**​/__tests__/**​/*.test.ts`?" — different questions
 * with the same answer for five of the six gate dirs, and different answers for
 * `src/server/scratchpad`, which is a source dir whose tests live in a subdir. A
 * `.test.ts` dropped directly in it passed the check and was collected by nothing.
 *
 * So: do not re-derive what vitest collects. *Ask vitest* (`vitest list`), and
 * compare that against what is on the *filesystem* (not the git index — an
 * unstaged new test is exactly the file a developer is about to trust `make
 * check` about).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json')));

/**
 * Anything a reasonable person would expect to be a test. Deliberately WIDER
 * than vitest's `include` glob: a file matching this but collected by no gate is
 * precisely the failure we are hunting — including the developer who writes
 * `foo.spec.ts` (vitest's own default `include` covers `*.{test,spec}.*`, ours
 * does not) and gets a permanently dead suite with no warning.
 */
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

/**
 * Directories to prune, as ROOT-RELATIVE paths — never bare basenames.
 *
 * A basename match prunes at *any depth*, which silently ate `src/coverage/` (a
 * real source directory) because the set contained 'coverage' for the report-output
 * dir at the repo root. Any test written under it was invisible to this guard and
 * collected by no gate: green `make check`, dead test. Same trap armed for a future
 * `src/build/` or `src/dist/`.
 */
const SKIP_PATHS = new Set(['node_modules', 'build', 'mcpb', 'dist', '.git', 'coverage']);

/**
 * Walks from the REPO ROOT, not from src/.
 *
 * vitest.config.ts's `include` is repo-wide (`**​/__tests__/**​/*.test.ts`) and its
 * comment says so explicitly: "a test added outside src/ must not be silently
 * skipped." A walk rooted at src/ cannot see a test at `scripts/__tests__/x.test.ts`
 * — vitest collects it, no gate runs it, and this guard exited 0 while promising,
 * in its own first line, to fail if ANY test file on disk is run by no gate.
 */
function walk(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = relative(ROOT, resolve(dir, entry.name));
    if (entry.isDirectory()) {
      if (!SKIP_PATHS.has(rel)) walk(resolve(dir, entry.name), out);
    } else if (TEST_FILE.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Positional path filters from a vitest script line (everything that isn't a flag). */
const pathsIn = (script) =>
  (script ?? '').split(/\s+/).filter((tok) => tok.startsWith('src/'));

/**
 * What vitest ACTUALLY collects for a gate's path filters — ground truth, straight
 * from the runner. Anything else is a re-implementation, and re-implementing the
 * runner's resolution is what broke the last version of this script.
 */
function collectedBy(paths) {
  if (paths.length === 0) return [];
  const out = execFileSync(
    'npx',
    ['vitest', 'list', '--filesOnly', ...paths],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * The commands CI actually executes: the value of every `run:` step in ci.yml,
 * with comments stripped.
 *
 * This used to be `ciWorkflow.includes('npm test')` — a substring match over the
 * whole file, comments included. Three comment lines in ci.yml contain the string
 * `npm test`, so deleting the real `- run: npm test` step left the flag TRUE and
 * the script kept reporting the unit suite as CI-guarded while nothing in CI ran
 * it. That is prior defect #3 — "a guard nothing invoked" — recreated inside the
 * very line written to detect it. This flag's entire job is to answer "does
 * something that RUNS invoke this?", so it must read the run steps, not the prose.
 */
function ciCommands() {
  const yaml = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
  return yaml
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())     // drop comments
    .filter((line) => /^-?\s*run:/.test(line))
    .map((line) => line.replace(/^-?\s*run:\s*/, '').trim())
    .filter(Boolean);
}

const CI_RUNS = ciCommands();

/** Does CI invoke this exact npm script? Matches the command, not a mention of it. */
const runsInCi = (script) =>
  CI_RUNS.some((cmd) => cmd === script || cmd.split(/\s*&&\s*/).some((part) => part.trim() === script));

if (CI_RUNS.length === 0) {
  console.error('check-test-gates: parsed ZERO run steps out of ci.yml — the CI check would pass vacuously.');
  process.exit(1);
}

const gates = [
  { name: 'npm test', paths: pathsIn(pkg.scripts.test), ci: runsInCi('npm test') },
  {
    name: 'npm run test:integration',
    paths: pathsIn(pkg.scripts['test:integration']),
    ci: runsInCi('npm run test:integration'),
  },
];

if (gates.every((g) => g.paths.length === 0)) {
  console.error('check-test-gates: no path filters found in the test scripts — refusing to pass vacuously.');
  process.exit(1);
}

for (const gate of gates) gate.collected = collectedBy(gate.paths);

const collected = new Set(gates.flatMap((g) => g.collected));
const onDisk = walk().sort();   // from ROOT — vitest's include is repo-wide, not src/-only
const orphans = onDisk.filter((f) => !collected.has(f));

if (orphans.length > 0) {
  console.error('check-test-gates: these test files are collected by NO gate — they run nowhere:\n');
  for (const f of orphans) console.error(`  ${f}`);
  console.error('\nA test vitest does not collect is a dead test that reports nothing.');
  console.error('Check BOTH: (a) the path is under a gate directory below, and (b) it');
  console.error(`matches vitest's include glob in vitest.config.ts (currently it must sit`);
  console.error(`under a __tests__/ directory and end in .test.ts).\n`);
  for (const g of gates) console.error(`  ${g.name}: ${g.paths.join(' ')}`);
  process.exit(1);
}

// Distinguish "runs in CI" from "runs only if a human remembers to". Reporting a
// manual-only gate as coverage is how a green line overstates what is guarded.
const ciCovered = new Set(gates.filter((g) => g.ci).flatMap((g) => g.collected));
const manualOnly = onDisk.filter((f) => !ciCovered.has(f));

console.log(`check-test-gates: ${onDisk.length} test files, all collected by a gate.`);
if (manualOnly.length > 0) {
  const names = gates.filter((g) => !g.ci).map((g) => g.name).join(', ');
  console.log(
    `  note: ${manualOnly.length} run only under ${names}, which no CI job invokes ` +
    `(needs live credentials) — they are not guarded against silently failing to load.`,
  );
}
