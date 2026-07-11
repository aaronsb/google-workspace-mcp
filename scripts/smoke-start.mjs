#!/usr/bin/env node
/**
 * Starts the BUILT server and asserts it completes an MCP handshake with tools loaded.
 *
 * This exists to make `engines.node` a tested claim rather than an advertisement.
 *
 * The package declares `"engines": { "node": ">=18.14.1" }`, but every CI job runs
 * Node 20 and the dev box runs Node 26 — so nothing ever executed the floor we
 * publish. That gap already cost us once: bumping `sanitize-html` to ^2.17.6 pulls
 * in the pure-ESM `htmlparser2@12`, and `sanitize-html` is itself CommonJS, so its
 * `require('htmlparser2')` throws ERR_REQUIRE_ESM on any Node below 20.19. It is a
 * static import in the startup graph (markdown.ts -> html-sanitize.ts), so EVERY
 * Node 18 consumer would have crashed on first start. It passed the whole test
 * suite and all four CI jobs.
 *
 * A dependency that is fine on the version you test and broken on the version you
 * ship is invisible to every check that runs on the version you test. So this runs
 * on the floor, against the PRODUCTION dependency tree (`npm ci --omit=dev`), and
 * exercises real module resolution — not a mock of it.
 *
 * Deliberately dependency-free and ES2021-plain: it must run on the oldest Node we
 * claim to support.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'build/index.js');
const TIMEOUT_MS = 30_000;

const request = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-start', version: '1' },
  },
}) + '\n';

const fail = (msg, extra) => {
  console.error(`smoke-start: FAIL — ${msg}`);
  if (extra) console.error(extra.trim());
  process.exit(1);
};

// cwd is deliberately NOT the project root: npx and the .mcpb bundle start the
// server from wherever the user happens to be, and manifest resolution must not
// depend on it.
const child = spawn(process.execPath, [ENTRY], {
  cwd: '/',
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, GOOGLE_CLIENT_ID: 'smoke.invalid', GOOGLE_CLIENT_SECRET: 'smoke' },
});

let stdout = '';
let stderr = '';
let settled = false;

const done = (code, msg, extra) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  child.kill('SIGKILL');
  if (code === 0) {
    console.log(`smoke-start: OK — ${msg} (node ${process.version})`);
    process.exit(0);
  }
  fail(msg, extra);
};

const timer = setTimeout(
  () => done(1, `server did not answer initialize within ${TIMEOUT_MS}ms`, stderr || stdout),
  TIMEOUT_MS,
);

child.stdout.on('data', (chunk) => {
  stdout += chunk;
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // partial line; wait for more
    }
    if (msg.id !== 1) continue;
    if (msg.error) return done(1, `initialize returned an error: ${JSON.stringify(msg.error)}`, stderr);
    if (!msg.result?.serverInfo?.name) return done(1, 'initialize result missing serverInfo', line);

    // The handshake alone proves the module graph loaded — which is the ERR_REQUIRE_ESM
    // class of failure. Also confirm the manifest actually resolved, so a build shipped
    // without build/factory/manifest cannot pass as "it started".
    const tools = /startup: (\d+) tools loaded/.exec(stderr);
    if (!tools) return done(1, 'server started but never reported loading tools (manifest not resolved?)', stderr);
    if (Number(tools[1]) === 0) return done(1, 'server loaded ZERO tools', stderr);

    return done(0, `handshake OK, ${tools[1]} tools loaded, cwd=/ (${msg.result.serverInfo.name})`);
  }
});

child.stderr.on('data', (chunk) => { stderr += chunk; });

child.on('error', (err) => done(1, `could not spawn the server: ${err.message}`));

child.on('exit', (code) => {
  if (settled) return;
  // A non-zero exit before answering initialize is the ERR_REQUIRE_ESM signature.
  done(1, `server exited with code ${code} before completing the handshake`, stderr || stdout);
});

child.stdin.write(request);
