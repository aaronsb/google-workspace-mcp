#!/usr/bin/env node
// Asserts the release identity is coherent before anything publishes: the tag,
// package.json, server.json, mcpb/manifest.json, and src/version.ts must name
// ONE version, and server.json must point at the npm package this repo
// actually publishes.
//
// version-sync.cjs writes only version fields, so a renamed npm package with a
// stale server.json identifier passes every version check and publishes a
// registry entry naming the wrong tarball (see ADR-105 for why the registry
// entry and the tarball must be treated as one release). This script is the
// one place the whole invariant lives; both release workflows and the Makefile
// fallback call it, so a future change to the tag scheme has one file to edit.
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const tag = process.argv[2];
if (!tag || !/^v\d/.test(tag)) {
  console.error(`usage: check-publish-identity.cjs vX.Y.Z (got ${tag || 'nothing'})`);
  process.exit(1);
}
const version = tag.slice(1);

const pkg = require(path.join(root, 'package.json'));
const server = require(path.join(root, 'server.json'));
const mcpbManifest = require(path.join(root, 'mcpb', 'manifest.json'));
const versionTs = fs.readFileSync(path.join(root, 'src', 'version.ts'), 'utf-8');
const versionTsMatch = versionTs.match(/VERSION = '([^']+)'/);

const failures = [];
const expect = (what, actual) => {
  if (actual !== version) failures.push(`${what} is ${actual}, tag says ${version}`);
};
expect('package.json version', pkg.version);
expect('server.json version', server.version);
expect('server.json packages[0].version', server.packages[0].version);
expect('mcpb/manifest.json version', mcpbManifest.version);
expect('src/version.ts VERSION', versionTsMatch && versionTsMatch[1]);
if (server.packages[0].identifier !== pkg.name) {
  failures.push(
    `server.json packages[0].identifier is ${server.packages[0].identifier}, package.json name is ${pkg.name}`
  );
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FATAL: ${f}`);
  console.error("Run 'make version-sync' and commit the result.");
  process.exit(1);
}
console.log(`${pkg.name}@${version}: tag, package.json, server.json, manifest, and src/version.ts agree`);
