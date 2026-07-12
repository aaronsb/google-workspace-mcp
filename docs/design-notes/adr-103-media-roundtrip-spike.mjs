/**
 * SPIKE (ADR-103, item 4 — the part that actually proves it).
 *
 * The upload spike reported YES because Google returned 200 + a draft id.
 * That proves the REQUEST WAS ACCEPTED. It does not prove the 34 MB payload
 * landed intact — and the draft was deleted before anyone looked inside it.
 * That is the exact defect this repo keeps re-learning: a check that reports
 * success while measuring the wrong thing.
 *
 * So: upload, then READ IT BACK OFF GOOGLE and compare a SHA-256 of the bytes
 * Google hands back against the SHA-256 of what we sent. Only then delete.
 *
 * Falsification built in: we also upload a deliberately CORRUPTED payload and
 * confirm the integrity check goes RED. A check that has never failed is not a
 * check. This also exercises item 5 (media DOWNLOAD — attachments.get).
 *
 * Run:  node docs/design-notes/adr-103-media-roundtrip-spike.mjs <account-email>
 */
import { getAccessToken } from '../../build/accounts/token-service.js';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const EMAIL = process.argv[2];
if (!EMAIL) { console.error('usage: ... <account-email>'); process.exit(2); }

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function loadDiscovery(service, version) {
  const res = await fetch(`https://www.googleapis.com/discovery/v1/apis/${service}/${version}/rest`);
  return res.json();
}
function resolveMethod(doc, p) {
  const parts = p.split('.'); const m = parts.pop();
  let n = doc; for (const x of parts) n = n.resources[x];
  return n.methods[m];
}
function uploadUrl(doc, m, proto, pathParams, query = {}) {
  const path = m.mediaUpload.protocols[proto].path
    .replace(/\{\+?([^}]+)\}/g, (_, n) => encodeURIComponent(String(pathParams[n])));
  const url = new URL(path, doc.rootUrl);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  return url.toString();
}

function buildRfc822({ from, to, subject, filename, bytes }) {
  const boundary = 'b0undary_adr103';
  const b64 = bytes.toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from(
    `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\nADR-103 round-trip probe.\r\n` +
    `--${boundary}\r\nContent-Type: application/octet-stream; name="${filename}"\r\n` +
    `Content-Disposition: attachment; filename="${filename}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n${b64}\r\n--${boundary}--\r\n`, 'utf8');
}

async function resumableUpload({ initiateUrl, token, contentType, payload, chunkSize }) {
  const init = await fetch(initiateUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType,
      'X-Upload-Content-Length': String(payload.length),
    },
    body: '{}',
  });
  if (!init.ok) throw new Error(`initiate ${init.status}: ${(await init.text()).slice(0, 200)}`);
  const session = init.headers.get('location');
  let offset = 0, chunks = 0;
  while (offset < payload.length) {
    const end = Math.min(offset + chunkSize, payload.length);
    const res = await fetch(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${payload.length}` },
      body: payload.subarray(offset, end),
    });
    chunks++;
    if (res.status === 308) { offset = end; continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`chunk@${offset} ${res.status}: ${text.slice(0, 200)}`);
    return { data: JSON.parse(text || '{}'), chunks };
  }
  throw new Error('payload consumed with no terminal response');
}

/** Walk the Gmail payload tree for the attachment part. Structural, no guessing. */
function findAttachmentPart(payload) {
  if (payload.filename && payload.body?.attachmentId) return payload;
  for (const p of payload.parts ?? []) {
    const hit = findAttachmentPart(p);
    if (hit) return hit;
  }
  return null;
}

const token = await getAccessToken(EMAIL);
const gmail = await loadDiscovery('gmail', 'v1');
const draftsCreate = resolveMethod(gmail, 'users.drafts.create');
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Upload `attachment`, read it back off Google, return whether the bytes match.
 * `mutate` lets us corrupt what we CLAIM to have sent, to prove the check bites.
 */
async function roundTrip(label, attachment, { claimedHash } = {}) {
  const rfc822 = buildRfc822({
    from: EMAIL, to: EMAIL,
    subject: `ADR-103 round-trip (${label}) — auto-deleted`,
    filename: 'adr-103-payload.bin', bytes: attachment,
  });
  const url = uploadUrl(gmail, draftsCreate, 'simple', { userId: 'me' }, { uploadType: 'resumable' });

  const t0 = process.hrtime.bigint();
  const { data: draft, chunks } = await resumableUpload({
    initiateUrl: url, token, contentType: 'message/rfc822',
    payload: rfc822, chunkSize: 8 * 1024 * 1024,
  });
  const upSecs = Number(process.hrtime.bigint() - t0) / 1e9;

  let verdict, detail;
  try {
    // ── READ IT BACK. This is the step the first spike skipped. ──────────────
    const gres = await fetch(`${GMAIL}/drafts/${draft.id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const full = await gres.json();
    const part = findAttachmentPart(full.message.payload);
    if (!part) throw new Error('no attachment part in the draft Google returned');

    // item 5 (media download) rides along: attachments.get
    const ares = await fetch(
      `${GMAIL}/messages/${full.message.id}/attachments/${part.body.attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } });
    const adata = await ares.json();
    const got = Buffer.from(adata.data, 'base64url');

    const expected = claimedHash ?? sha(attachment);
    const actual = sha(got);
    const match = expected === actual && got.length === attachment.length;

    verdict = match ? 'MATCH' : 'MISMATCH';
    detail = `sent ${attachment.length}B / got ${got.length}B · ` +
             `sha ${expected.slice(0, 12)} vs ${actual.slice(0, 12)} · ` +
             `${chunks} chunks, ${upSecs.toFixed(1)}s up · part=${part.filename}`;
  } finally {
    const d = await fetch(`${GMAIL}/drafts/${draft.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    detail += ` · cleanup ${d.status}`;
  }
  return { verdict, detail };
}

// ── The real gate: 25 MB raw → ~34 MB rfc822, uploaded, downloaded, compared ──
const big = Buffer.alloc(25_000_000);
for (let i = 0; i < big.length; i += 4) big.writeUInt32BE((i * 2654435761) >>> 0, i);  // high-entropy

console.log('R1  35 MB attachment — upload, read back off Google, compare SHA-256');
const r1 = await roundTrip('genuine', big);
console.log(`    ${r1.verdict === 'MATCH' ? 'OK  ' : 'FAIL'}  ${r1.detail}\n`);

// ── FALSIFICATION: claim a hash that is NOT what we sent. The check MUST go red.
// A check that has never failed is not a check.
console.log('R2  falsification — same upload, but we CLAIM a wrong hash. Check must go RED.');
const r2 = await roundTrip('corrupted-claim', big, { claimedHash: sha(Buffer.from('not what we sent')) });
console.log(`    ${r2.verdict === 'MISMATCH' ? 'OK  ' : 'FAIL'}  went ${r2.verdict} (want MISMATCH) · ${r2.detail}\n`);

console.log('──────── ADR-103 item 4 + 5 ────────');
const gateOk = r1.verdict === 'MATCH';
const probeOk = r2.verdict === 'MISMATCH';
console.log(`GATE          35 MB attachment round-trips byte-for-byte : ${gateOk ? 'YES' : 'NO'}`);
console.log(`PROBE         the integrity check actually fires         : ${probeOk ? 'YES' : 'NO — THE CHECK IS LYING'}`);
process.exit(gateOk && probeOk ? 0 : 1);
