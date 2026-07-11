#!/usr/bin/env node
/**
 * Entrypoint. Deliberately imports NOTHING from the server graph at module scope.
 *
 * ESM evaluates static imports before the importing module's body runs, so a
 * `import { startServer } from './server/server.js'` here would pull in the whole
 * dependency graph — including `sanitize-html`, which is CommonJS and `require()`s
 * the pure-ESM `htmlparser2` — BEFORE any check in this file could execute. On a
 * Node below the floor that throws `ERR_REQUIRE_ESM` from deep inside node_modules:
 * a stack trace naming somebody else's files, for a problem that is entirely ours.
 *
 * So the version check runs first, and the server is loaded by DYNAMIC import only
 * once the runtime is known to be adequate. This is the one place in the codebase
 * where import style is load-bearing; do not "tidy" it into a static import.
 *
 * This matters most for the .mcpb bundle, whose manifest runs a bare `node` — the
 * HOST's runtime, whose version we neither control nor can test in CI.
 */

/** Keep in sync with `engines.node` in package.json. */
const MIN_NODE = '22.12.0';

function parse(version: string): number[] {
  return version.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}

/** True if `actual` is at least `min`. Plain compare, no dependency — by design. */
function meets(actual: string, min: string): boolean {
  const a = parse(actual);
  const m = parse(min);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (m[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (m[i] ?? 0)) return false;
  }
  return true;
}

if (!meets(process.versions.node, MIN_NODE)) {
  process.stderr.write(
    `\n[gws-mcp] This server requires Node >=${MIN_NODE}, but is running on ${process.version}.\n\n` +
    `  Node 18 and Node 20 are both end-of-life (April 2025 and April 2026).\n` +
    `  Upgrading is the fix: https://nodejs.org/en/download\n\n` +
    `  Running this as a Claude Desktop extension (.mcpb)? The bundle uses the Node\n` +
    `  runtime Claude Desktop provides — upgrade the app rather than this server.\n\n`,
  );
  process.exit(1);
}

// Dynamic, and only after the guard above. See the file header.
const { startServer } = await import('./server/server.js');

// Prevent unhandled rejections from crashing the server
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[gws-mcp] unhandled rejection: ${reason}\n`);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[gws-mcp] uncaught exception: ${err.message}\n${err.stack}\n`);
});

startServer().catch((err) => {
  process.stderr.write(`[gws-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
