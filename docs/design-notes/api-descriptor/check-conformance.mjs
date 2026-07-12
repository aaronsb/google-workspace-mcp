/**
 * Build step (rehearsal): generate -> write descriptor.json -> validate manifest ⊆ descriptor.
 *
 * In the target shape this is `scripts/generate-discovery.mjs` plus a check wired
 * into `make check`. Here it is one script so the whole loop is visible.
 *
 * The validation is ADR-103 item 10: every `resource:` in the manifest must
 * resolve to a real Google method, and every param the manifest sends must be one
 * Google declares. Today a typo like `users.mesages.list` is a runtime surprise
 * discovered on a user's behalf. It should be a build failure.
 *
 *   node docs/design-notes/api-descriptor/check-conformance.mjs           generate + write + check
 *   node docs/design-notes/api-descriptor/check-conformance.mjs --check   check only (no network)
 *   node docs/design-notes/api-descriptor/check-conformance.mjs --probe   prove the check can fail
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';
import { loadManifest } from '../../../build/factory/generator.js';
import { patches } from '../../../build/factory/patches.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESCRIPTOR = join(HERE, 'descriptor.json');
const checkOnly = process.argv.includes('--check');

// ── generate ─────────────────────────────────────────────────────────────────────
if (!checkOnly) {
  console.log('generating Google Discovery …');
  const descriptor = await generate();
  writeFileSync(DESCRIPTOR, JSON.stringify(descriptor, null, 2) + '\n');
  const n = Object.values(descriptor.services).reduce((a, s) => a + Object.keys(s.methods).length, 0);
  const kb = (readFileSync(DESCRIPTOR).length / 1024).toFixed(0);
  console.log(`descriptor: ${n} methods, ${Object.keys(descriptor.services).length} services, ${kb} KB`);
  for (const [name, svc] of Object.entries(descriptor.services)) {
    console.log(`  ${name.padEnd(9)} ${String(Object.keys(svc.methods).length).padStart(3)} methods  ${svc.discoveryUrl}`);
  }
}

if (!existsSync(DESCRIPTOR)) { console.error('no descriptor.json — run without --check first'); process.exit(2); }
const descriptor = JSON.parse(readFileSync(DESCRIPTOR, 'utf8'));

// ── validate: manifest ⊆ descriptor (item 10) ──────────────────────────────────
console.log('\nchecking manifest ⊆ descriptor …');
const { services } = loadManifest();
const problems = [];
let resourceOps = 0, helperOps = 0, customOps = 0, paramsChecked = 0;

// `manifestOverride` exists ONLY so the probe below can inject a known-bad op and
// confirm this check goes red. A check nobody has seen fail is not a check.
export function validate(descriptor, services, manifestOverride) {
  for (const svc of Object.values(manifestOverride ?? services)) {
    const service = svc.gws_service;
    const generated = descriptor.services[service];
    if (!generated) { problems.push(`service '${service}' is in the manifest but was not generated`); continue; }

    for (const [op, def] of Object.entries(svc.operations ?? {})) {
      if (def.helper) { helperOps++; continue; }   // gws inventions; Google never declared them

      // A custom handler SHORT-CIRCUITS buildArgs (generator.ts:218) — it builds its
      // own args in TypeScript. So this op's manifest params are NEVER dispatched,
      // and validating them is measuring the wrong thing. The first version of this
      // check did exactly that and reported 8 confident false positives.
      //
      // We still verify the RESOURCE resolves (the manifest documents it, and
      // coverage counts it) — we just do not police its params.
      const custom = !!patches[service]?.customHandlers?.[op];
      if (custom) customOps++;
      resourceOps++;

      const m = generated.methods[def.resource];
      if (!m) { problems.push(`${service}.${op}: resource '${def.resource}' does not exist in Google's surface`); continue; }
      if (custom) continue;

      // Factory-path ops only. Every param we SEND must be one Google DECLARES —
      // or be a body member. GET/DELETE have no body, so an undeclared param there
      // is silently dropped, which is a real bug.
      const declared = { ...generated.globalParameters, ...m.parameters };
      const bodyless = m.httpMethod === 'GET' || m.httpMethod === 'DELETE';
      const sends = new Set([
        ...Object.keys(def.defaults ?? {}),
        ...Object.entries(def.params ?? {})
          .filter(([, p]) => !p.client_only)
          .map(([name, p]) => p.maps_to ?? name),
      ]);
      for (const p of sends) {
        paramsChecked++;
        if (!declared[p] && bodyless) {
          problems.push(`${service}.${op}: sends '${p}' to ${def.resource} (${m.httpMethod}), which Google does not declare — a ${m.httpMethod} has no body, so it would be silently dropped`);
        }
      }
    }
  }
}
validate(descriptor, services);

// Snapshot the REAL counts now. The probe below calls validate() again with fake
// services, which would otherwise inflate these — a check reporting a wrong
// number is the same defect in miniature.
const COUNTS = { resourceOps, helperOps, customOps, paramsChecked };
console.log(`  ${COUNTS.resourceOps} resource ops (${COUNTS.customOps} custom-handled: params not policed), ${COUNTS.helperOps} helper ops, ${COUNTS.paramsChecked} params checked`);

// ── PROBE: make the check fail on purpose. ───────────────────────────────────
// Every guard in this repo carries a probe proving it fires. This one exists
// because the FIRST version of this check reported 8 confident false positives
// while missing that custom handlers bypass buildArgs entirely — it was green on
// nothing and red on noise. So: inject the two defects it claims to catch, and
// confirm it goes red on both.
if (process.argv.includes('--probe')) {
  const runProbe = (label, fakeService) => {
    const saved = problems.splice(0, problems.length);   // isolate
    validate(descriptor, null, { probe: fakeService });
    const caught = problems.length > 0;
    console.log(`  ${caught ? 'RED  ' : 'GREEN'}  ${label}${caught ? ` → ${problems[0].slice(0, 84)}` : '  *** THE CHECK DID NOT FIRE ***'}`);
    problems.splice(0, problems.length, ...saved);
    return caught;
  };

  console.log('\nprobe — injecting the failures this check claims to catch:');
  const a = runProbe('typo in a resource path (users.mesages.list)', {
    gws_service: 'gmail',
    operations: { bogus: { resource: 'users.mesages.list', params: {} } },
  });
  const b = runProbe('param Google does not declare, on a GET', {
    gws_service: 'gmail',
    operations: { bogus: { resource: 'users.messages.list', params: { nonsense: { type: 'string' } } } },
  });
  const c = runProbe('a real op that should NOT fire (control)', {
    gws_service: 'gmail',
    operations: { fine: { resource: 'users.messages.list', params: { q: { type: 'string' } } } },
  });
  if (!a || !b) { console.error('\nPROBE FAILED: the check does not catch what it claims to.'); process.exit(1); }
  if (c) { console.error('\nPROBE FAILED: the check fires on a VALID op — it would cry wolf.'); process.exit(1); }
  console.log('  probe OK — fires on both defects, silent on the control.\n');
}
if (problems.length === 0) {
  console.log(`\ncheck-descriptor: OK — all ${COUNTS.resourceOps} resource ops resolve against Google's surface.`);
  const total = Object.values(descriptor.services).reduce((a, s) => a + Object.keys(s.methods).length, 0);
  const exposed = COUNTS.resourceOps + COUNTS.helperOps;
  console.log(`coverage: ${exposed} of ${total} generated methods exposed — ${total - exposed} are the visible frontier.`);
  process.exit(0);
}
console.error(`\ncheck-descriptor: ${problems.length} PROBLEM(S)`);
for (const p of problems) console.error(`  ✗ ${p}`);
process.exit(1);
