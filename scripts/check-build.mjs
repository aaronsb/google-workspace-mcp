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
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Returns null if the directory cannot be READ for any reason — missing, not a
 * directory, no permission. An existsSync check alone is not enough: a dir that
 * exists but is unreadable threw a raw node:fs stack trace over this script's own
 * curated error, so the person who just ran `npm run build` got fs internals
 * instead of the sentence explaining what was wrong.
 */
const yamls = (dir) => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort();
  } catch {
    return null;
  }
};

const errors = [];

const src = resolve(ROOT, 'src/factory/manifest');
const built = resolve(ROOT, 'build/factory/manifest');
const entry = resolve(ROOT, 'build/index.js');

const want = yamls(src);
const got = yamls(built);

if (want === null) {
  errors.push('src/factory/manifest is MISSING — there is nothing to copy from.');
} else if (want.length === 0) {
  errors.push('src/factory/manifest contains no .yaml files.');
}

if (got === null) {
  errors.push('build/factory/manifest is MISSING — the manifest copy step did not run.');
} else if (want?.length) {
  const missing = want.filter((f) => !got.includes(f));
  const extra = got.filter((f) => !want.includes(f));
  if (missing.length > 0) {
    errors.push(
      `build/factory/manifest is INCOMPLETE — ${got.length}/${want.length} service ` +
      `manifests copied. Missing: ${missing.join(', ')}\n` +
      `  The server would start and silently advertise fewer services, with no error.`,
    );
  }
  if (extra.length > 0) {
    errors.push(
      `build/factory/manifest has STALE files not in src/: ${extra.join(', ')}\n` +
      `  The build should rm -rf the directory before copying.`,
    );
  }
}

if (!existsSync(entry)) {
  errors.push('build/index.js is MISSING — tsc did not emit an entrypoint.');
}

// Ask the LOADER, don't re-derive it. Everything above compares filenames, which is
// this script's own idea of what a service manifest is. The thing that actually
// matters is what `loadManifest()` will read at startup — so load it and compare.
// A guard that enumerates the manifest differently from the loader it is guarding
// is, once again, a check measuring something other than what it claims.
if (errors.length === 0) {
  try {
    const { loadManifest } = await import(pathToFileURL(resolve(ROOT, 'build/factory/generator.js')).href);
    const loaded = Object.keys(loadManifest().services).sort();
    const expected = want.map((f) => f.replace(/\.yaml$/, '')).sort();
    const lost = expected.filter((s) => !loaded.includes(s));
    if (lost.length > 0) {
      errors.push(
        `the built loader resolves ${loaded.length}/${expected.length} services. Missing: ${lost.join(', ')}`,
      );
    }
  } catch (err) {
    errors.push(`the built loader could not read its manifest: ${err.message}`);
  }
}

if (errors.length > 0) {
  console.error('check-build: the built output is not shippable:\n');
  for (const e of errors) console.error(`  ${e}`);
  console.error('\nThis is what a consumer would install. Re-run `npm run build`.');
  process.exit(1);
}

console.log(
  `check-build: build/ is complete (${got.length} service manifests, loader resolves all of them, entrypoint present).`,
);
