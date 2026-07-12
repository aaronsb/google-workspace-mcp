#!/usr/bin/env node
/**
 * Post-pack sanity check — inspects a packed .mcpb bundle and fails
 * if any file imported from build/factory/patches.js is absent.
 *
 * History: v2.6.0 shipped with `docs/` as an unanchored entry in
 * .mcpbignore, which silently matched server/services/docs/ and
 * dropped the compiled Docs patch. The server crashed at import
 * time with ERR_MODULE_NOT_FOUND. This script catches that class
 * of regression before release.
 *
 * Usage: node scripts/verify-mcpb.cjs <bundle.mcpb>
 */

const fs = require('node:fs');
const { execSync } = require('node:child_process');
const path = require('node:path');

const bundle = process.argv[2];
if (!bundle) {
  console.error('usage: verify-mcpb.cjs <path-to-mcpb>');
  process.exit(2);
}
if (!fs.existsSync(bundle)) {
  console.error(`bundle not found: ${bundle}`);
  process.exit(2);
}

// Read every file that build/factory/patches.js imports. Expected shape:
//   import { gmailPatch } from '../services/gmail/patch.js';
const patchesSource = fs.readFileSync(
  path.join(__dirname, '..', 'build', 'factory', 'patches.js'),
  'utf-8',
);
const importRe = /from\s+['"](\.\.\/services\/[^'"]+)['"]/g;
const expected = new Set();
let m;
while ((m = importRe.exec(patchesSource)) !== null) {
  // "../services/docs/patch.js" → "server/services/docs/patch.js"
  expected.add('server/' + m[1].replace(/^\.\.\//, ''));
}

if (expected.size === 0) {
  console.error('verify-mcpb: no services found in build/factory/patches.js — refusing to silently pass');
  process.exit(2);
}

const listing = execSync(`unzip -l "${bundle}"`, { encoding: 'utf-8' });
const missing = [];
for (const file of expected) {
  if (!listing.includes(file)) missing.push(file);
}

if (missing.length > 0) {
  console.error(`verify-mcpb: bundle is missing ${missing.length} required file(s):`);
  for (const f of missing) console.error(`  - ${f}`);
  console.error(`\nCheck mcpb/.mcpbignore for patterns that may be filtering nested paths.`);
  process.exit(1);
}

// --- the manifest's `tools` list must be the tools the server actually serves ---
//
// This is the list Claude Desktop shows a user when they install the extension: it is
// the bundle's advertised surface. Nothing compared it to the server, so it drifted —
// it sat at 8 tools while the server served 11, hiding manage_meet, manage_scratchpad
// and manage_workspace from everyone who read the manifest to find out what they had
// just installed. A stale list produces no error; it just quietly under-sells.
//
// The oracle is the BUILT server's own toolSchemas, not a re-derivation of it from the
// yaml manifests — a second derivation can agree with the manifest and still be wrong
// about the server. Dynamic-import it out-of-process because this script is CJS and
// build/ is ESM.
const served = JSON.parse(execSync(
  `node --input-type=module -e "` +
  `const m = await import('${path.join(__dirname, '..', 'build', 'server', 'tools.js')}');` +
  `console.log(JSON.stringify(m.toolSchemas.map(t => t.name)));"`,
  { encoding: 'utf-8' },
));

if (served.length === 0) {
  console.error('verify-mcpb: the server reports ZERO tools — refusing to silently pass');
  process.exit(2);
}

const declared = require(path.join(__dirname, '..', 'mcpb', 'manifest.json'))
  .tools.map((t) => t.name);

const undeclared = served.filter((t) => !declared.includes(t));
const phantom = declared.filter((t) => !served.includes(t));

if (undeclared.length > 0 || phantom.length > 0) {
  console.error('verify-mcpb: mcpb/manifest.json does not match the tools the server serves.');
  for (const t of undeclared) console.error(`  - ${t}: served, but NOT declared in the manifest`);
  for (const t of phantom) console.error(`  - ${t}: declared in the manifest, but NOT served`);
  console.error('\nFix mcpb/manifest.json "tools" so it lists exactly what the server exposes.');
  process.exit(1);
}

console.log(
  `verify-mcpb: ok (${expected.size} service patches present, ` +
  `${served.length} tools declared == served, in ${path.basename(bundle)})`,
);
