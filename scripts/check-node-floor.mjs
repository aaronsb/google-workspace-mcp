#!/usr/bin/env node
/**
 * Asserts the Node floor is the SAME NUMBER everywhere it is written down.
 *
 * The floor lives in three places, and each one is load-bearing in a different way:
 *
 *   1. package.json `engines.node`  — what npm tells a consumer at install time.
 *   2. ci.yml `engines-floor` job   — the Node the built server is actually EXECUTED on.
 *   3. src/index.ts `MIN_NODE`      — the runtime guard that produces a readable error
 *                                     instead of ERR_REQUIRE_ESM, and the only defence
 *                                     the .mcpb bundle has (it runs the HOST's node).
 *
 * If (1) drifts above (2), the floor we publish is no longer the floor we test, and a
 * dependency broken below it merges green — that is precisely how the sanitize-html
 * startup crash happened. If (3) drifts, the guard rejects runtimes that are fine or,
 * worse, waves through runtimes that are not.
 *
 * The comment in ci.yml used to say "keep in sync." A coupling maintained by a comment
 * is a coupling maintained by nobody. This is the check.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const found = {};
const errors = [];

// 1. package.json engines.node — expect a bare ">=X.Y.Z"
const engines = JSON.parse(read('package.json')).engines?.node;
const enginesMatch = /^>=\s*(\d+\.\d+\.\d+)$/.exec(engines ?? '');
if (!enginesMatch) {
  errors.push(
    `package.json engines.node is ${JSON.stringify(engines)} — expected an exact ">=X.Y.Z" ` +
    `so it can be compared against the version CI actually runs.`,
  );
} else {
  found['package.json engines.node'] = enginesMatch[1];
}

// 2. ci.yml — the node-version of the engines-floor job's SECOND setup-node (the one
//    that runs the built server). Scoped to that job so the other jobs, which track
//    current Node on purpose, are not dragged into the comparison.
const ci = read('.github/workflows/ci.yml');
const floorJob = /^ {2}engines-floor:$([\s\S]*?)(?=^ {2}\S|\Z)/m.exec(ci);
if (!floorJob) {
  errors.push('.github/workflows/ci.yml has no `engines-floor:` job — the floor is executed by nothing.');
} else {
  const versions = [...floorJob[1].matchAll(/node-version:\s*'([^']+)'/g)].map((m) => m[1]);
  const exact = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  if (exact.length !== 1) {
    errors.push(
      `the engines-floor job declares ${exact.length} exact node-versions (${JSON.stringify(versions)}) — ` +
      `expected exactly one pinned X.Y.Z, the floor to execute.`,
    );
  } else {
    found['ci.yml engines-floor job'] = exact[0];
  }
}

// 3. src/index.ts MIN_NODE
const minNode = /const MIN_NODE = '([^']+)'/.exec(read('src/index.ts'));
if (!minNode) {
  errors.push('src/index.ts has no `const MIN_NODE = \'...\'` — the startup guard is gone.');
} else {
  found['src/index.ts MIN_NODE'] = minNode[1];
}

const versions = [...new Set(Object.values(found))];
if (errors.length === 0 && versions.length > 1) {
  errors.push('the Node floor DISAGREES across the places it is declared:');
  for (const [where, v] of Object.entries(found)) errors.push(`    ${v.padEnd(10)} ${where}`);
  errors.push(
    '  The floor we publish, the floor we execute in CI, and the floor the server\n' +
    '  enforces at startup must be one number. Pick one and change all three.',
  );
}

if (errors.length > 0) {
  console.error('check-node-floor:\n');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(`check-node-floor: Node >=${versions[0]} — declared, executed in CI, and enforced at startup.`);
