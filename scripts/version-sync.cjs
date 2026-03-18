#!/usr/bin/env node
// Sync version from package.json → server.json + mcpb/manifest.json
const fs = require('fs');
const version = require('../package.json').version;

for (const file of ['server.json', 'mcpb/manifest.json']) {
  if (!fs.existsSync(file)) continue;
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  data.version = version;
  if (data.packages) data.packages.forEach(p => p.version = version);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ${file} → ${version}`);
}
