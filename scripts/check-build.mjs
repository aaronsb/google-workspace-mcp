#!/usr/bin/env node
/**
 * Verifies the built output is complete. Runs as `postbuild`, so a broken build
 * fails at the moment it is produced rather than on a consumer's first start.
 *
 * The build copies the manifest into the tarball's only shipped directory:
 *
 *   rm -rf build/factory/manifest && cp -r src/factory/manifest build/factory/manifest
 *
 * `cp -r` is not atomic. An interrupted or partially-failed copy (disk full,
 * Ctrl-C, a killed CI step) leaves a SUBSET of the service YAMLs behind, and a
 * subset is not an error to any code that merely asks "does a manifest exist?" —
 * the server starts happily and advertises a fraction of its tools, so an agent
 * silently loses Gmail or Drive with nothing logged anywhere.
 *
 * Presence is not integrity. This checks the built manifest is the SAME SET as
 * the source manifest, and that `build/` carries an entrypoint at all.
 */
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const yamls = (dir) => readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();

const errors = [];

const src = resolve(ROOT, 'src/factory/manifest');
const built = resolve(ROOT, 'build/factory/manifest');

if (!existsSync(built)) {
  errors.push(`build/factory/manifest is MISSING — the manifest copy step did not run.`);
} else {
  const want = yamls(src);
  const got = yamls(built);
  const missing = want.filter((f) => !got.includes(f));
  const extra = got.filter((f) => !want.includes(f));

  if (want.length === 0) errors.push(`src/factory/manifest contains no .yaml files.`);
  if (missing.length > 0) {
    errors.push(
      `build/factory/manifest is INCOMPLETE — ${got.length}/${want.length} service ` +
      `manifests copied. Missing: ${missing.join(', ')}\n` +
      `  The server would start and silently advertise only ${got.length} of ${want.length} services.`,
    );
  }
  if (extra.length > 0) {
    errors.push(
      `build/factory/manifest has STALE files not in src/: ${extra.join(', ')}\n` +
      `  The build should rm -rf the directory before copying.`,
    );
  }
}

if (!existsSync(resolve(ROOT, 'build/index.js'))) {
  errors.push(`build/index.js is MISSING — tsc did not emit an entrypoint.`);
}

if (errors.length > 0) {
  console.error('check-build: the built output is not shippable:\n');
  for (const e of errors) console.error(`  ${e}`);
  console.error('\nThis is what a consumer would install. Re-run `npm run build`.');
  process.exit(1);
}

console.log(
  `check-build: build/ is complete (${yamls(built).length} service manifests, entrypoint present).`,
);
