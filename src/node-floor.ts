/**
 * The Node version floor, and the comparison that enforces it.
 *
 * Split out of index.ts so it can be UNIT TESTED. It previously lived inline in the
 * entrypoint, where it was untestable — and that mattered: a revert of the pre-release
 * fix once slipped through `make check`, all 681 tests and every CI job, because nothing
 * anywhere exercised the comparison. `check-node-floor.mjs` checks that MIN_NODE has the
 * right VALUE and that the entrypoint imports the server dynamically; neither says
 * anything about whether the arithmetic is correct.
 *
 * This module imports only `node:fs` (a builtin). It CANNOT trigger the ESM/CJS failure
 * the guard exists to prevent, so index.ts may import it statically. Only the server
 * graph must stay behind the dynamic import.
 */
import { writeSync } from 'node:fs';

/** Keep in sync with `engines.node`, the engines-floor CI job, and mcpb/manifest.json. */
export const MIN_NODE = '22.12.0';

interface Version { parts: number[]; prerelease: boolean }

/**
 * `22.12.0-rc.1` is *below* `22.12.0`, not equal to it (semver §11.3).
 *
 * An earlier version split on '.' and parseInt'd each part, so `-rc.1` landed in the
 * patch slot, `parseInt('0-rc', 10)` came out 0, and the release candidate compared
 * EQUAL to the floor — waved through, in the dangerous direction. Node's nightly and RC
 * builds do report a suffixed `process.versions.node`, and a pre-release of the floor
 * release may predate the very `require(ESM)` backport this floor exists to guarantee.
 */
function parse(version: string): Version {
  const [core, ...rest] = version.replace(/^v/, '').split('-');
  return {
    parts: core.split('.').map((n) => parseInt(n, 10) || 0),
    prerelease: rest.length > 0,
  };
}

/** True if `actual` is at least `min`. Plain compare, no dependency — by design. */
export function meets(actual: string, min: string): boolean {
  const a = parse(actual);
  const m = parse(min);
  for (let i = 0; i < 3; i++) {
    const av = a.parts[i] ?? 0;
    const mv = m.parts[i] ?? 0;
    if (av > mv) return true;
    if (av < mv) return false;
  }
  // Cores equal: a pre-release of that core sorts BEFORE the release itself, so it
  // passes only if the floor is that same pre-release.
  return !a.prerelease || m.prerelease;
}

export function floorMessage(actual: string, min: string = MIN_NODE): string {
  return (
    `\n[gws-mcp] This server requires Node >=${min}, but is running on ${actual}.\n\n` +
    `  Node 18 and Node 20 are both end-of-life (April 2025 and April 2026).\n` +
    `  Upgrading is the fix: https://nodejs.org/en/download\n\n` +
    `  Running this as a Claude Desktop extension (.mcpb)? The bundle uses the Node\n` +
    `  runtime Claude Desktop provides — upgrade the app rather than this server.\n\n`
  );
}

/**
 * Exits the process if the running Node is below the floor.
 *
 * `writeSync`, NOT `process.stderr.write`: Node's writes to a PIPE are asynchronous on
 * macOS (synchronous only on Linux/Windows), and Claude Desktop spawns the .mcpb server
 * with piped stdio — on the platform where .mcpb matters most. `process.stderr.write(...)`
 * followed immediately by `process.exit(1)` can tear the process down before the buffer
 * drains, leaving a bare exit code and NO message: strictly worse than the stack trace
 * this replaces. This is the one code path whose entire value is its output.
 */
export function enforceNodeFloor(actual: string = process.versions.node): void {
  if (meets(actual, MIN_NODE)) return;
  writeSync(2, floorMessage(`v${actual.replace(/^v/, '')}`));
  process.exit(1);
}
