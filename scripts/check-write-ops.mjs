#!/usr/bin/env node
/**
 * Every write operation must be able to carry content.
 *
 * A POST/PUT/PATCH whose manifest entry exposes no BODY fields can only ever send an
 * empty body, and Google's answer to that is never an error you would trace back here:
 *
 *   tasks.insert      {} -> 200, and a blank task appears in the user's list
 *   tasks.patch       {} -> 500 "Internal error encountered", which reads like an outage
 *   documents.create  {} -> 200, and the document is called "Untitled document"
 *
 * The failure is silent in the worst way: the argument a caller wants to send isn't in
 * the tool's schema at all, so passing `title` drops it without a word, and the operation
 * reports success.
 *
 * The check: for each write op, take the params the manifest declares, subtract the ones
 * Google declares as path/query (plus the globals), and whatever remains is what can go
 * in the body. If that set is empty — and there is no `defaults:` block and no custom
 * handler building the body in code — the operation cannot do its job.
 *
 * Runs in `make check`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const MANIFEST_DIR = 'src/factory/manifest';
const descriptor = JSON.parse(readFileSync('src/google/descriptor.json', 'utf-8'));

/**
 * Operations that legitimately send an empty body. Each is a Google method whose entire
 * input is the resource it addresses — there is nothing to put in a body.
 *
 * This list is deliberately explicit. A blanket "allow empty bodies" would let the next
 * tasks.create through.
 */
const BODILESS = new Set([
  'gmail:users.messages.trash',      // the id in the path IS the request
  'gmail:users.messages.untrash',
  'sheets:spreadsheets.values.clear', // clears the addressed range; body is {}
  'calendar:events.quickAdd',         // its `text` is a QUERY param, not a body field
]);

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH']);

const failures = [];
let checked = 0;

for (const file of readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.yaml'))) {
  const manifest = parse(readFileSync(join(MANIFEST_DIR, file), 'utf-8'));
  const service = manifest.google_service;
  const svc = descriptor.services[service];
  if (!svc) continue;

  // A custom handler builds its own request body in code, so the manifest need not.
  const patchFile = `src/services/${service}/patch.ts`;
  const patchSource = existsSync(patchFile) ? readFileSync(patchFile, 'utf-8') : '';

  for (const [opName, op] of Object.entries(manifest.operations)) {
    if (!op.resource) continue;
    const method = svc.methods[op.resource];
    if (!method || !WRITE_VERBS.has(method.httpMethod)) continue;

    const key = `${service}:${op.resource}`;
    if (BODILESS.has(key)) continue;

    checked++;

    // `defaults:` injects fixed body content (manage_tasks.complete sends status=completed).
    if (op.defaults && Object.keys(op.defaults).length > 0) continue;

    // A custom handler for this operation constructs the body itself.
    if (new RegExp(`\\b${opName}\\s*:\\s*async`).test(patchSource)) continue;

    // Everything Google declares as path or query. Anything else lands in the body.
    const declared = new Set([
      ...Object.keys(method.parameters ?? {}),
      ...Object.keys(svc.globalParameters ?? {}),
    ]);
    const bodyFields = Object.entries(op.params ?? {})
      .filter(([name, def]) => !declared.has(def?.maps_to ?? name))
      .map(([name]) => name);

    if (bodyFields.length === 0) {
      failures.push({
        tool: manifest.tool_name,
        opName,
        resource: op.resource,
        httpMethod: method.httpMethod,
      });
    }
  }
}

if (failures.length > 0) {
  console.error('check-write-ops: these write operations cannot carry any content.\n');
  console.error('They will send an EMPTY body to Google, which either creates a blank');
  console.error('resource or fails with an error that looks like Google\'s fault.\n');
  for (const f of failures) {
    console.error(`  ${f.httpMethod.padEnd(5)} ${f.tool}.${f.opName}  ->  ${f.resource}`);
  }
  console.error('\nFix by one of:');
  console.error('  - declare the body fields in the manifest (e.g. title, notes)');
  console.error('  - add a `defaults:` block if the body is fixed');
  console.error('  - write a custom handler that builds the body');
  console.error('  - add it to BODILESS in this script IF Google truly takes no body');
  process.exit(1);
}

if (checked === 0) {
  console.error('check-write-ops: checked ZERO write operations — refusing to pass vacuously.');
  process.exit(2);
}

console.log(`check-write-ops: ok (${checked} write operations can all carry a request body).`);
