#!/usr/bin/env node
/**
 * Generate docs/api-surface.md — every method Google publishes, and whether we expose it.
 *
 * The point is to make the frontier BROWSABLE. `make coverage` prints the gaps for a
 * maintainer; this is the same truth written for someone who wants a capability we do
 * not have yet and needs to point at the exact method and argue for it.
 *
 * Descriptions are GOOGLE'S OWN, copied verbatim from the Discovery documents. They are
 * not paraphrased and not "interpreted": a plausible-sounding gloss invented for 170-odd
 * methods nobody has used would be indistinguishable from an accurate one, and wrong in
 * places nobody would think to check. Where Google's wording is terse, that is Google's
 * wording.
 *
 * Regenerate:  npm run generate-api-surface
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const REPO = 'aaronsb/google-workspace-mcp';
const OUT = 'docs/api-surface.md';

const descriptor = JSON.parse(readFileSync('src/google/descriptor.json', 'utf-8'));

// --- what the manifest exposes: google method -> the MCP operation that reaches it ---
const exposed = new Map();      // "gmail:users.messages.get" -> "manage_email.read"
const toolFor = new Map();      // "gmail" -> "manage_email"
for (const file of readdirSync('src/factory/manifest').filter((f) => f.endsWith('.yaml'))) {
  const m = parse(readFileSync(join('src/factory/manifest', file), 'utf-8'));
  toolFor.set(m.google_service, m.tool_name);
  for (const [opName, op] of Object.entries(m.operations)) {
    if (!op.resource) continue;
    const key = `${m.google_service}:${op.resource}`;
    // Several operations can reach the same method (complete and update are both
    // tasks.patch). List them all rather than letting the last one win.
    const existing = exposed.get(key);
    const label = `${m.tool_name} ${opName}`;
    exposed.set(key, existing ? `${existing}, ${opName}` : label);
  }
}

/** Flatten Discovery's nested resources into dotted method names. */
function walk(node, prefix, out = {}) {
  for (const [name, method] of Object.entries(node.methods ?? {})) {
    out[prefix ? `${prefix}.${name}` : name] = method;
  }
  for (const [name, child] of Object.entries(node.resources ?? {})) {
    walk(child, prefix ? `${prefix}.${name}` : name, out);
  }
  return out;
}

/** Google's prose, made safe for a markdown table cell. */
function describe(text) {
  if (!text) return '—';
  return text
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')                       // a pipe would break the row
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // flatten md links; the URLs add noise
    .trim();
}

/** A pre-filled issue, so requesting a method is one click and a paragraph. */
function requestLink(service, method, httpMethod, description) {
  const title = `Expose ${service}.${method}`;
  const body = [
    `**Method:** \`${service}.${method}\` (\`${httpMethod}\`)`,
    ``,
    `**Google's description:** ${describe(description)}`,
    ``,
    `### What do you want to do that you can't do today?`,
    ``,
    `_Describe the task, not the method. What are you trying to get the agent to accomplish?_`,
    ``,
    `### Why does an existing operation not cover it?`,
    ``,
    `_The server exposes a curated subset on purpose — more surface is not better. What did you try, and where did it fall short?_`,
    ``,
  ].join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent('enhancement')}`;
}

const lines = [];
const summary = [];
let totalCovered = 0;
let totalMethods = 0;

const services = Object.keys(descriptor.services).sort();
const perService = [];

for (const service of services) {
  const svc = descriptor.services[service];
  process.stderr.write(`[api-surface] reading ${service} from Google...\n`);

  const res = await fetch(svc.discoveryUrl);
  if (!res.ok) throw new Error(`could not read Discovery for ${service}: ${res.status}`);
  const doc = await res.json();

  const methods = walk(doc, '');
  const names = Object.keys(methods).sort();
  const covered = names.filter((n) => exposed.has(`${service}:${n}`));

  totalCovered += covered.length;
  totalMethods += names.length;

  const tool = toolFor.get(service) ?? '—';
  summary.push(
    `| [${service}](#${service}) | \`${tool}\` | ${covered.length} / ${names.length} | ${Math.round((covered.length / names.length) * 100)}% |`,
  );

  perService.push({ service, tool, doc, methods, names, covered });
}

lines.push('# The Google API surface');
lines.push('');
lines.push('<!-- GENERATED FILE — DO NOT EDIT. Run `npm run generate-api-surface`. -->');
lines.push('');
lines.push('Every method Google publishes for the seven APIs this server targets, and whether we expose it. Descriptions are **Google\'s own**, quoted verbatim from the [Discovery documents](https://developers.google.com/discovery) — the same specification the client is generated from. They are not paraphrased.');
lines.push('');
lines.push('**Missing something?** Click **Request** on the method. It opens a pre-filled issue. Read **[API coverage](coverage.md)** first — it explains what makes a request persuasive.');
lines.push('');
lines.push(`**${totalCovered} of ${totalMethods} methods exposed (${Math.round((totalCovered / totalMethods) * 100)}%).**`);
lines.push('');
lines.push('| API | MCP tool | Exposed | |');
lines.push('|---|---|---:|---:|');
lines.push(...summary);
lines.push('');

for (const { service, tool, doc, methods, names, covered } of perService) {
  lines.push(`## ${service}`);
  lines.push('');
  lines.push(`\`${tool}\` — ${covered.length} of ${names.length} methods exposed. Google Discovery: \`${doc.id ?? service}\`.`);
  lines.push('');
  lines.push('| Method | | Status |');
  lines.push('|---|---|---|');

  for (const name of names) {
    const m = methods[name];
    const key = `${service}:${name}`;
    const op = exposed.get(key);
    const status = op
      ? `✅ \`${op}\``
      : `[Request](${requestLink(service, name, m.httpMethod, m.description)})`;
    lines.push(`| \`${name}\`<br>*${m.httpMethod}* | ${describe(m.description)} | ${status} |`);
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('Why the subset is curated, and what makes a request persuasive: **[API coverage](coverage.md)**.');
lines.push('');

writeFileSync(OUT, lines.join('\n'));
console.log(`generate-api-surface: wrote ${OUT} — ${totalMethods} methods across ${services.length} APIs, ${totalCovered} exposed.`);
