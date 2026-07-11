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
const SKIP_DIR = new Set(['node_modules', 'build', 'mcpb', 'dist', '.git', 'coverage']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) walk(resolve(dir, entry.name), out);
    } else if (TEST_FILE.test(entry.name)) {
      out.push(relative(ROOT, resolve(dir, entry.name)));
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

// Which gates actually run in CI. A gate nothing invokes is not coverage — the
// integration suite needs live Google credentials and no CI job runs it, so a
// file "covered" only by it is still unguarded against silently failing to load.
const ciWorkflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');

const gates = [
  { name: 'npm test', paths: pathsIn(pkg.scripts.test), ci: ciWorkflow.includes('npm test') },
  {
    name: 'npm run test:integration',
    paths: pathsIn(pkg.scripts['test:integration']),
    ci: ciWorkflow.includes('npm run test:integration'),
  },
];

if (gates.every((g) => g.paths.length === 0)) {
  console.error('check-test-gates: no path filters found in the test scripts — refusing to pass vacuously.');
  process.exit(1);
}

for (const gate of gates) gate.collected = collectedBy(gate.paths);

const collected = new Set(gates.flatMap((g) => g.collected));
const onDisk = walk(resolve(ROOT, 'src')).sort();
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
