#!/usr/bin/env node
/**
 * Entrypoint. Deliberately imports NOTHING from the server graph at module scope.
 *
 * ESM evaluates static imports before the importing module's body runs, so
 * `import { startServer } from './server/server.js'` here would pull in the whole
 * dependency graph — including `sanitize-html`, which is CommonJS and `require()`s the
 * pure-ESM `htmlparser2` — BEFORE any check in this file could execute. On a Node below
 * the floor that throws `ERR_REQUIRE_ESM` from deep inside node_modules: a stack trace
 * naming somebody else's files, for a problem that is entirely ours.
 *
 * So the floor is enforced first, and the server is loaded by DYNAMIC import only once
 * the runtime is known to be adequate. This matters most for the .mcpb bundle, whose
 * manifest runs a bare `node` — the HOST's runtime, whose version we neither control nor
 * can test in CI.
 *
 * This ordering is NOT protected by this comment — comments protect nothing.
 * `scripts/smoke-reject.mjs` runs the built entrypoint on a below-floor Node and fails if
 * ERR_REQUIRE_ESM ever leaks (CI job `engines-floor-reject`), and `check-node-floor.mjs`
 * rejects a static import of the server graph outright. Those are what protect it.
 *
 * `./node-floor.js` imports only `node:fs` (a builtin), so it cannot trigger the failure
 * this file guards against. Only the SERVER GRAPH must stay behind the dynamic import.
 */
import { enforceNodeFloor } from './node-floor.js';

enforceNodeFloor();

// Dynamic, and only after the floor is enforced. See the file header.
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
