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

console.log(`verify-mcpb: ok (${expected.size} service patches present in ${path.basename(bundle)})`);
