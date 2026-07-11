#!/usr/bin/env node
/**
 * Fails if any test file is run by no gate.
 *
 * `npm test` uses an allowlist of vetted, fully-mocked directories rather than a
 * denylist, so that a future network-touching test cannot auto-enrol itself into
 * the CI gate. The cost of an allowlist is the opposite failure: a test added
 * outside those directories is collected by no gate at all, runs nowhere, and
 * reports nothing — green CI, dead test.
 *
 * A comment promising "every test runs somewhere" is a claim. This is the check.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

/** Positional path filters from a vitest script line (everything that isn't a flag). */
const pathsIn = (script) =>
  (script ?? '')
    .split(/\s+/)
    .filter((tok) => tok.startsWith('src/'));

const gates = {
  'npm test': pathsIn(pkg.scripts.test),
  'npm run test:integration': pathsIn(pkg.scripts['test:integration']),
};

const covered = Object.values(gates).flat();
if (covered.length === 0) {
  console.error('check-test-gates: no path filters found in the test scripts — refusing to pass vacuously.');
  process.exit(1);
}

const onDisk = execFileSync('git', ['ls-files', '*.test.ts'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const orphans = onDisk.filter((f) => !covered.some((dir) => f.startsWith(`${dir}/`)));

if (orphans.length > 0) {
  console.error('check-test-gates: these test files are run by NO gate:\n');
  for (const f of orphans) console.error(`  ${f}`);
  console.error('\nAdd them to a directory an existing gate covers, or extend the');
  console.error('allowlist in package.json "test" (mocked, no network) or');
  console.error('"test:integration" (live Google APIs). Gates:\n');
  for (const [name, dirs] of Object.entries(gates)) console.error(`  ${name}: ${dirs.join(' ')}`);
  process.exit(1);
}

console.log(`check-test-gates: ${onDisk.length} test files, all covered by a gate.`);
