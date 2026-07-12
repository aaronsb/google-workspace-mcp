/**
 * SPIKE (ADR-103, verification item 2): the differential harness.
 *
 * gws still works, which makes it a TEST ORACLE — and it is rotting. Use it
 * while it is still trustworthy.
 *
 * For each resource op: feed IDENTICAL params to gws and to an uninterpreted
 * Discovery dispatcher, call LIVE Google through both, and deep-diff the JSON.
 *
 * THIS IS NOT A PARITY GATE. We EXPECT divergence wherever gws interpreted.
 * Each divergence is a FINDING, and the question for each is:
 *     is this Google's truth, or gws's opinion?
 * Google's truth we must reproduce. gws's opinion we deliberately discard.
 *
 * Volatility guard: two live calls can differ for boring reasons (a historyId
 * ticks, an etag rolls). So any op that diffs is RE-RUN on both sides. If the
 * diff set changes between runs, it is VOLATILE, not a divergence. Without this
 * the harness would report noise as findings — a check measuring the wrong thing.
 *
 * SAFETY: read-only. Only GET ops run. The 34 mutating ops (POST/PATCH/PUT/
 * DELETE) are NOT executed against a live account by this harness.
 *
 * Run: node docs/design-notes/adr-103-differential-harness.mjs <account-email>
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { getAccessToken } from '../../build/accounts/token-service.js';
import { call as clientCall } from './miner/client.mjs';

// The CANDIDATE side is now the real client, driven by the MINED CONTRACT —
// not a bespoke dispatcher written for this harness. If this still reproduces
// gws exactly, the rehearsal code is what item 2 actually validated.
const contract = JSON.parse(readFileSync(new URL('./miner/contract.json', import.meta.url), 'utf8'));

const exec = promisify(execFile);
const EMAIL = process.argv[2];
const ONLY = process.argv[3];               // optional: only ops matching this substring
if (!EMAIL) { console.error('usage: ... <account-email> [filter]'); process.exit(2); }

const GWS = 'node_modules/.bin/gws';
const token = await getAccessToken(EMAIL);

// ── the two sides ────────────────────────────────────────────────────────────

/** ORACLE: gws, invoked exactly as src/factory/generator.ts buildResourceArgs does. */
async function viaGws(service, resource, params) {
  const args = [service, ...resource.split('.'), '--params', JSON.stringify(params)];
  const { stdout } = await exec(GWS, args, {
    env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  return JSON.parse(stdout || '{}');
}

/** CANDIDATE: the mined contract + the client we own. No bespoke dispatch code. */
async function viaDiscovery(service, resource, params) {
  return clientCall(contract, service, resource, params, { token });
}

// ── deep diff: report json-paths that differ. No normalisation, no mercy. ────
function diff(a, b, path = '', out = []) {
  if (a === b) return out;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { out.push(`${path || '$'}: type ${ta} vs ${tb}`); return out; }
  if (ta === 'array') {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (ta === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out.push(`${path}.${k}: MISSING in gws`); continue; }
      if (!(k in b)) { out.push(`${path}.${k}: MISSING in discovery`); continue; }
      diff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return out;
}

// ── seed real IDs from the live account (read-only) ──────────────────────────
console.log(`seeding from ${EMAIL} ...`);
const seed = {};
const tryseed = async (name, fn) => { try { seed[name] = await fn(); } catch (e) { seed[name] = null; } };

await tryseed('messageId', async () => (await viaDiscovery('gmail', 'users.messages.list', { userId: 'me', maxResults: 1 })).messages?.[0]?.id);
await tryseed('threadId', async () => (await viaDiscovery('gmail', 'users.threads.list', { userId: 'me', maxResults: 1 })).threads?.[0]?.id);
await tryseed('fileId', async () => (await viaDiscovery('drive', 'files.list', { pageSize: 1 })).files?.[0]?.id);
await tryseed('docId', async () => (await viaDiscovery('drive', 'files.list', { q: "mimeType='application/vnd.google-apps.document' and trashed=false", pageSize: 1 })).files?.[0]?.id);
await tryseed('sheetId', async () => (await viaDiscovery('drive', 'files.list', { q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", pageSize: 1 })).files?.[0]?.id);
await tryseed('eventId', async () => (await viaDiscovery('calendar', 'events.list', { calendarId: 'primary', maxResults: 1, singleEvents: true, orderBy: 'startTime' })).items?.[0]?.id);
await tryseed('taskListId', async () => (await viaDiscovery('tasks', 'tasklists.list', { maxResults: 1 })).items?.[0]?.id);
await tryseed('taskId', async () => seed.taskListId ? (await viaDiscovery('tasks', 'tasks.list', { tasklist: seed.taskListId, maxResults: 1 })).items?.[0]?.id : null);
await tryseed('conferenceRecord', async () => (await viaDiscovery('meet', 'conferenceRecords.list', { pageSize: 1 })).conferenceRecords?.[0]?.name);
// an attachment: walk the first few messages for one with a real attachmentId
await tryseed('attachment', async () => {
  const list = await viaDiscovery('gmail', 'users.messages.list', { userId: 'me', q: 'has:attachment', maxResults: 3 });
  for (const { id } of list.messages ?? []) {
    const full = await viaDiscovery('gmail', 'users.messages.get', { userId: 'me', id, format: 'full' });
    const walk = (p) => p.body?.attachmentId ? { messageId: id, attachmentId: p.body.attachmentId } : (p.parts ?? []).map(walk).find(Boolean);
    const hit = walk(full.payload ?? {});
    if (hit) return hit;
  }
  return null;
});
for (const [k, v] of Object.entries(seed)) {
  console.log(`  ${k.padEnd(17)} ${v ? (typeof v === 'object' ? JSON.stringify(v).slice(0, 46) : String(v).slice(0, 46)) : '— none found (ops needing it will SKIP)'}`);
}

// ── the 36 GET ops, with params. Mutating ops are deliberately absent. ───────
const S = seed;
const CASES = [
  // calendar
  ['calendar.list',            'calendar', 'events.list',        { calendarId: 'primary', maxResults: 10, singleEvents: true, orderBy: 'startTime' }],
  ['calendar.get',             'calendar', 'events.get',         S.eventId && { calendarId: 'primary', eventId: S.eventId }],
  ['calendar.calendars',       'calendar', 'calendarList.list',  {}],
  // docs
  ['docs.get',                 'docs',     'documents.get',      S.docId && { documentId: S.docId }],
  // drive
  ['drive.search',             'drive',    'files.list',         { pageSize: 10 }],
  ['drive.get',                'drive',    'files.get',          S.fileId && { fileId: S.fileId }],
  ['drive.listPermissions',    'drive',    'permissions.list',   S.fileId && { fileId: S.fileId }],
  ['drive.listComments',       'drive',    'comments.list',      S.fileId && { fileId: S.fileId, fields: '*' }],
  // gmail
  ['gmail.search',             'gmail',    'users.messages.list', { userId: 'me', maxResults: 10 }],
  ['gmail.read',               'gmail',    'users.messages.get',  S.messageId && { userId: 'me', id: S.messageId, format: 'full' }],
  ['gmail.labels',             'gmail',    'users.labels.list',   { userId: 'me' }],
  ['gmail.threads',            'gmail',    'users.threads.list',  { userId: 'me', maxResults: 10 }],
  ['gmail.getThread',          'gmail',    'users.threads.get',   S.threadId && { userId: 'me', id: S.threadId }],
  ['gmail.getAttachment',      'gmail',    'users.messages.attachments.get', S.attachment && { userId: 'me', messageId: S.attachment.messageId, id: S.attachment.attachmentId }],
  // sheets
  ['sheets.get',               'sheets',   'spreadsheets.get',        S.sheetId && { spreadsheetId: S.sheetId }],
  ['sheets.getValues',         'sheets',   'spreadsheets.values.get', S.sheetId && { spreadsheetId: S.sheetId, range: 'A1:D10' }],
  // tasks
  ['tasks.listTaskLists',      'tasks',    'tasklists.list',     { maxResults: 10 }],
  ['tasks.getTaskList',        'tasks',    'tasklists.get',      S.taskListId && { tasklist: S.taskListId }],
  ['tasks.list',               'tasks',    'tasks.list',         S.taskListId && { tasklist: S.taskListId, maxResults: 10 }],
  ['tasks.get',                'tasks',    'tasks.get',          S.taskListId && S.taskId && { tasklist: S.taskListId, task: S.taskId }],
  // meet
  ['meet.listConferences',     'meet',     'conferenceRecords.list',                    { pageSize: 10 }],
  ['meet.getConference',       'meet',     'conferenceRecords.get',                     S.conferenceRecord && { name: S.conferenceRecord }],
  ['meet.listParticipants',    'meet',     'conferenceRecords.participants.list',       S.conferenceRecord && { parent: S.conferenceRecord }],
  ['meet.listTranscripts',     'meet',     'conferenceRecords.transcripts.list',        S.conferenceRecord && { parent: S.conferenceRecord }],
  ['meet.listRecordings',      'meet',     'conferenceRecords.recordings.list',         S.conferenceRecord && { parent: S.conferenceRecord }],
  ['meet.listSmartNotes',      'meet',     'conferenceRecords.smartNotes.list',         S.conferenceRecord && { parent: S.conferenceRecord }],
];

// ── run ──────────────────────────────────────────────────────────────────────
const R = { same: [], diverged: [], volatile: [], skipped: [], errored: [] };
console.log(`\nrunning ${CASES.length} read-only ops through BOTH gws and Discovery dispatch\n`);

for (const [name, service, resource, params] of CASES) {
  if (ONLY && !name.includes(ONLY)) continue;
  if (!params) { R.skipped.push([name, 'no seed data']); console.log(`SKIP  ${name.padEnd(24)} no seed data`); continue; }

  let g, d;
  try { g = await viaGws(service, resource, params); }
  catch (e) { R.errored.push([name, `gws: ${String(e.message).split('\n')[0].slice(0, 90)}`]); console.log(`ERR   ${name.padEnd(24)} gws: ${String(e.message).split('\n')[0].slice(0, 70)}`); continue; }
  try { d = await viaDiscovery(service, resource, params); }
  catch (e) { R.errored.push([name, `discovery: ${String(e.message).slice(0, 90)}`]); console.log(`ERR   ${name.padEnd(24)} discovery: ${String(e.message).slice(0, 70)}`); continue; }

  let paths = diff(g, d);
  if (paths.length === 0) { R.same.push(name); console.log(`SAME  ${name.padEnd(24)} identical (${Object.keys(d).join(',').slice(0, 44)})`); continue; }

  // Volatility guard: re-run both. A diff that does not reproduce is noise.
  const g2 = await viaGws(service, resource, params).catch(() => null);
  const d2 = await viaDiscovery(service, resource, params).catch(() => null);
  const paths2 = (g2 && d2) ? diff(g2, d2) : paths;
  const stable = JSON.stringify(paths) === JSON.stringify(paths2);

  if (!stable) {
    R.volatile.push([name, paths.length]);
    console.log(`VOL   ${name.padEnd(24)} ${paths.length} diffs, did NOT reproduce → volatile, not divergence`);
  } else {
    R.diverged.push([name, paths]);
    console.log(`DIFF  ${name.padEnd(24)} ${paths.length} stable diff(s)`);
    for (const p of paths.slice(0, 6)) console.log(`        ${p.slice(0, 110)}`);
    if (paths.length > 6) console.log(`        … ${paths.length - 6} more`);
  }
}

// ── coverage, computed against the real manifest ─────────────────────────────
// NO SILENT CAPS. "0 divergences" is a lie if the reader thinks it means "over
// all 70 ops". Ask the manifest what exists, and name every op we did NOT diff.
const { loadManifest } = await import('../../build/factory/generator.js');
const { services } = loadManifest();
const allResourceOps = [];
for (const svc of Object.values(services)) {
  for (const [op, def] of Object.entries(svc.operations ?? {})) {
    if (def.resource) allResourceOps.push(`${svc.gws_service}.${op}`);
  }
}
const covered = new Set(CASES.filter(c => c[3]).map(c => c[0]));
const uncovered = allResourceOps.filter(o => !covered.has(o));

console.log('\n════════ coverage ════════');
console.log(`resource ops in manifest   ${allResourceOps.length}`);
console.log(`diffed live against gws    ${covered.size}`);
console.log(`NOT diffed                 ${uncovered.length}`);
if (uncovered.length) {
  console.log('\nNOT diffed by this harness:');
  for (const o of uncovered) console.log(`  - ${o}`);
}

console.log('\n════════ ADR-103 item 2 ════════');
console.log(`identical           ${String(R.same.length).padStart(2)}`);
console.log(`stable divergence   ${String(R.diverged.length).padStart(2)}   <- each is a FINDING: Google's truth, or gws's opinion?`);
console.log(`volatile            ${String(R.volatile.length).padStart(2)}   (diff did not reproduce; not a divergence)`);
console.log(`errored             ${String(R.errored.length).padStart(2)}`);
console.log(`skipped (no seed)   ${String(R.skipped.length).padStart(2)}`);
if (R.diverged.length) {
  console.log('\nDIVERGENCES to triage (item 3):');
  for (const [n, p] of R.diverged) console.log(`  ${n}: ${p.length}`);
}
if (R.errored.length) {
  console.log('\nERRORS:');
  for (const [n, e] of R.errored) console.log(`  ${n}: ${e}`);
}
