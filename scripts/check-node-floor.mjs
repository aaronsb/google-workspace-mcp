#!/usr/bin/env node
/**
 * Asserts the Node floor is the SAME NUMBER everywhere it is written down, AND that
 * the CI jobs which are supposed to exercise it actually contain the steps that do.
 *
 * The floor lives in four places, each load-bearing in a different way:
 *
 *   1. package.json `engines.node`        — what npm tells a consumer at install time.
 *   2. ci.yml `engines-floor` job         — the Node the built server is EXECUTED on.
 *   3. src/node-floor.ts `MIN_NODE`       — the runtime guard that produces a readable
 *                                           error instead of ERR_REQUIRE_ESM. index.ts must
 *                                           CALL it, and must not statically import the
 *                                           server graph, or it runs after the crash.
 *   4. mcpb/manifest.json                 — `compatibility.runtimes.node`; the ONLY one
 *      the .mcpb host reads, and the only thing that can stop Claude Desktop from
 *      installing this extension onto a runtime that cannot run it.
 *
 * If (1) drifts above (2), the floor we publish is no longer the floor we test, and a
 * dependency broken below it merges green — exactly how the sanitize-html startup crash
 * happened. If (3) drifts, the guard rejects good runtimes or waves through bad ones.
 * If (4) drifts, the bundle advertises itself as compatible with every Node in existence.
 *
 * Two earlier versions of this script were themselves instances of the bug it exists to
 * catch, which is why it now works the way it does:
 *
 *   - It matched `node-version:` in COMMENT text, so a commented-out pin still reported
 *     "executed in CI" (the same defect as the previous round's comment-grepping CI flag).
 *     Comments are stripped before anything is matched.
 *   - It asserted the floor was "executed in CI" while checking only that a version
 *     STRING appeared — deleting the steps that actually run the server left it green.
 *     It now requires the executing steps to be present by name.
 *   - It used `\Z` as an end-of-input anchor. JavaScript has no `\Z` (that is Python and
 *     PCRE); it matches a literal 'Z'. The job-scoping regex only terminated by luck.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

/** Strip YAML comments. Naive but sufficient: no `#` appears inside a quoted scalar here. */
const stripComments = (yaml) =>
  yaml.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');

const found = {};
const errors = [];

// ---- 1. package.json engines.node ------------------------------------------------
const engines = JSON.parse(read('package.json')).engines?.node;
const enginesMatch = /^>=\s*(\d+\.\d+\.\d+)$/.exec(engines ?? '');
if (!enginesMatch) {
  errors.push(
    `package.json engines.node is ${JSON.stringify(engines)} — expected an exact ">=X.Y.Z", ` +
    `so it can be compared against the version CI actually runs.`,
  );
} else {
  found['package.json engines.node'] = enginesMatch[1];
}

// ---- 2 & the CI jobs that must exercise the floor ---------------------------------
const ci = stripComments(read('.github/workflows/ci.yml'));

/** The body of a top-level job, scoped from its key to the next top-level key or EOF. */
function jobBody(name) {
  // `$(?![\s\S])` is a real end-of-input anchor. `\Z` is not one in JavaScript.
  const re = new RegExp(`^ {2}${name}:$([\\s\\S]*?)(?=^ {2}\\S|$(?![\\s\\S]))`, 'm');
  return re.exec(ci)?.[1] ?? null;
}

const floorJob = jobBody('engines-floor');
if (!floorJob) {
  errors.push('.github/workflows/ci.yml has no `engines-floor:` job — the floor is executed by nothing.');
} else {
  const versions = [...floorJob.matchAll(/node-version:\s*'([^']+)'/g)].map((m) => m[1]);
  const exact = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  if (exact.length !== 1) {
    errors.push(
      `the engines-floor job declares ${exact.length} exact node-versions (${JSON.stringify(versions)}) — ` +
      `expected exactly one pinned X.Y.Z: the floor to execute.`,
    );
  } else {
    found['ci.yml engines-floor job'] = exact[0];
  }
  // Declaring a version is not executing on it. Require the steps that actually run
  // the built server against the production tree — deleting them used to leave this
  // script cheerfully reporting "executed in CI".
  for (const step of ['npm ci --omit=dev', 'scripts/smoke-start.mjs']) {
    if (!floorJob.includes(step)) {
      errors.push(`the engines-floor job no longer runs \`${step}\` — it declares the floor but does not execute on it.`);
    }
  }
}

// The reject path needs its own coverage: a job that runs the entrypoint BELOW the floor
// and proves the guard actually fires. Without it, reverting src/index.ts's dynamic import
// to a static one restores the ERR_REQUIRE_ESM crash with every gate still green.
const rejectJob = jobBody('engines-floor-reject');
if (!rejectJob) {
  errors.push(
    '.github/workflows/ci.yml has no `engines-floor-reject:` job — nothing proves the startup ' +
    'guard actually REJECTS a below-floor Node. The guard\'s whole purpose is untested.',
  );
} else if (!rejectJob.includes('scripts/smoke-reject.mjs')) {
  errors.push('the engines-floor-reject job does not run `scripts/smoke-reject.mjs`.');
}

// ---- 3. src/node-floor.ts MIN_NODE -------------------------------------------------
const floorSrc = read('src/node-floor.ts');
const minNode = /^export const MIN_NODE = '([^']+)'/m.exec(floorSrc);
if (!minNode) {
  errors.push("src/node-floor.ts has no `export const MIN_NODE = '...'` — the startup guard is gone.");
} else {
  found['src/node-floor.ts MIN_NODE'] = minNode[1];
}

const indexSrc = read('src/index.ts');
if (!/enforceNodeFloor\(\)/.test(indexSrc)) {
  errors.push('src/index.ts never calls enforceNodeFloor() — the floor is declared but not enforced at startup.');
}

// The guard is only worth anything if the server graph is reached by a DYNAMIC import
// after it. A static import evaluates before this file's body runs, so the crash would
// happen before the check. smoke-reject proves this behaviorally on a below-floor Node;
// this catches it at lint speed, with a message that says why.
if (/^import\s[^;]*from\s+'\.\/server\//m.test(indexSrc)) {
  errors.push(
    "src/index.ts statically imports the server graph. ESM evaluates static imports BEFORE\n" +
    "    this file's body, so the version guard would run only AFTER the very crash it exists\n" +
    "    to prevent. Load the server with `await import('./server/server.js')` instead.",
  );
}

// ---- 4. mcpb/manifest.json compatibility.runtimes.node -----------------------------
if (existsSync(resolve(ROOT, 'mcpb/manifest.json'))) {
  const runtime = JSON.parse(read('mcpb/manifest.json')).compatibility?.runtimes?.node;
  const runtimeMatch = /^>=\s*(\d+\.\d+\.\d+)$/.exec(runtime ?? '');
  if (!runtimeMatch) {
    errors.push(
      `mcpb/manifest.json compatibility.runtimes.node is ${JSON.stringify(runtime)} — expected ">=X.Y.Z". ` +
      `This is the only floor the .mcpb host reads; without it the bundle claims to run on any Node.`,
    );
  } else {
    found['mcpb/manifest.json runtimes.node'] = runtimeMatch[1];
  }
}

// ---- they must all be the same number ----------------------------------------------
const versions = [...new Set(Object.values(found))];
if (errors.length === 0 && versions.length > 1) {
  errors.push('the Node floor DISAGREES across the places it is declared:');
  for (const [where, v] of Object.entries(found)) errors.push(`    ${v.padEnd(10)} ${where}`);
  errors.push(
    '  The floor we publish, the floor we execute, the floor the server enforces at startup,\n' +
    '  and the floor the .mcpb host reads must be ONE number. Pick one and change all four.',
  );
}

if (errors.length > 0) {
  console.error('check-node-floor:\n');
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(
  `check-node-floor: Node >=${versions[0]} — declared (npm + mcpb), executed in CI above AND ` +
  `below the floor, and enforced at startup by a dynamic-import guard.`,
);
