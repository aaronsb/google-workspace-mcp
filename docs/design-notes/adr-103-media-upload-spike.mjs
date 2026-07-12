/**
 * SPIKE (ADR-103, verification item 4): media upload without gws.
 *
 * The gate ADR-103 sets is a WORKING 35 MB attachment, not a specification read.
 * This proves — against LIVE Google, with our own OAuth — that the upload
 * protocol is as mechanical as resource-style dispatch was in item 1.
 *
 * Four questions, in order of how badly a NO would hurt:
 *
 *   Q1  Simple upload (uploadType=media) — does Discovery's declared path work?
 *   Q2  Multipart upload (uploadType=multipart) — metadata + bytes in one request?
 *   Q3  Resumable — Discovery DECLARES `/resumable/upload/...`, but Google's own
 *       clients use `/upload/...?uploadType=resumable`. Which does Google serve?
 *       Assume nothing. Try BOTH and record what answers.
 *   Q4  THE GATE: a 35 MB Gmail attachment, chunked resumable, message/rfc822.
 *
 * Every artifact this creates is deleted on the way out.
 *
 * Run:  node docs/design-notes/adr-103-media-upload-spike.mjs <account-email>
 * (requires `npm run build` first — it imports our real token-service, because
 *  the method here is to ASK THE TOOL, never re-derive what it does.)
 */
import { getAccessToken } from '../../build/accounts/token-service.js';
import { Buffer } from 'node:buffer';

const EMAIL = process.argv[2];
if (!EMAIL) {
  console.error('usage: node adr-103-media-upload-spike.mjs <account-email>');
  process.exit(2);
}

const docCache = new Map();
async function loadDiscovery(service, version) {
  const key = `${service}/${version}`;
  if (!docCache.has(key)) {
    const res = await fetch(`https://www.googleapis.com/discovery/v1/apis/${service}/${version}/rest`);
    if (!res.ok) throw new Error(`discovery ${key}: ${res.status}`);
    docCache.set(key, await res.json());
  }
  return docCache.get(key);
}

function resolveMethod(doc, resourcePath) {
  const parts = resourcePath.split('.');
  const method = parts.pop();
  let node = doc;
  for (const p of parts) node = node.resources?.[p];
  return node.methods[method];
}

/**
 * The whole point: the upload URL is READ FROM THE DOC, not constructed by us.
 * `mediaUpload.protocols.<proto>.path` is root-relative, so resolving it against
 * rootUrl is the entire algorithm. No interpretation.
 */
function uploadUrl(doc, m, proto, pathParams, query = {}) {
  const declared = m.mediaUpload?.protocols?.[proto]?.path;
  if (!declared) throw new Error(`no ${proto} upload protocol declared`);
  const path = declared.replace(/\{\+?([^}]+)\}/g, (_, n) => encodeURIComponent(String(pathParams[n])));
  const url = new URL(path, doc.rootUrl);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  return url.toString();
}

const results = [];
function record(id, question, verdict, detail) {
  results.push({ id, question, verdict, detail });
  const mark = verdict === 'YES' ? '  OK  ' : verdict === 'NO' ? ' FAIL ' : ' NOTE ';
  console.log(`[${mark}] ${id}  ${detail}`);
}

// ── MIME. We removed our builder when gws grew --attach (src/services/gmail/mime.ts).
// Retiring gws means owning this again. This is the minimum honest version.
function buildRfc822({ from, to, subject, body, filename, bytes, contentType }) {
  const boundary = 'b0undary_adr103_spike';
  const b64 = bytes.toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from(
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    `${body}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}; name="${filename}"\r\n` +
    `Content-Disposition: attachment; filename="${filename}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${b64}\r\n` +
    `--${boundary}--\r\n`,
    'utf8',
  );
}

/** Resumable, done properly: initiate → chunked PUTs with Content-Range. */
async function resumableUpload({ initiateUrl, token, contentType, payload, metadata, chunkSize }) {
  const init = await fetch(initiateUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType,
      'X-Upload-Content-Length': String(payload.length),
    },
    body: JSON.stringify(metadata ?? {}),
  });
  if (!init.ok) {
    return { ok: false, status: init.status, stage: 'initiate', body: (await init.text()).slice(0, 400) };
  }
  const session = init.headers.get('location');
  if (!session) return { ok: false, status: init.status, stage: 'initiate', body: 'no Location header' };

  // Chunked PUTs. Google requires each non-final chunk to be a multiple of 256 KiB.
  let offset = 0;
  let chunks = 0;
  while (offset < payload.length) {
    const end = Math.min(offset + chunkSize, payload.length);
    const slice = payload.subarray(offset, end);
    const res = await fetch(session, {
      method: 'PUT',
      headers: {
        'Content-Length': String(slice.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${payload.length}`,
      },
      body: slice,
    });
    chunks++;
    if (res.status === 308) {          // "Resume Incomplete" — the protocol working as designed
      offset = end;
      continue;
    }
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, stage: `chunk@${offset}`, body: text.slice(0, 400), chunks };
    return { ok: true, status: res.status, data: JSON.parse(text || '{}'), chunks };
  }
  return { ok: false, stage: 'exhausted', body: 'payload consumed without a terminal response', chunks };
}

// ──────────────────────────────────────────────────────────────────────────────
const token = await getAccessToken(EMAIL);
console.log(`token acquired for ${EMAIL} (not printed)\n`);

const drive = await loadDiscovery('drive', 'v3');
const gmail = await loadDiscovery('gmail', 'v1');
const filesCreate = resolveMethod(drive, 'files.create');
const draftsCreate = resolveMethod(gmail, 'users.drafts.create');

const created = [];   // drive file ids to clean up
let draftId = null;

try {
  // ── Q1: simple upload ───────────────────────────────────────────────────────
  {
    const payload = Buffer.from('adr-103 simple upload probe\n');
    const url = uploadUrl(drive, filesCreate, 'simple', {}, { uploadType: 'media' });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: payload,
    });
    const data = await res.json();
    if (res.ok && data.id) {
      created.push(data.id);
      record('Q1', 'simple upload (uploadType=media)', 'YES', `drive files.create → ${res.status}, id=${data.id}`);
    } else {
      record('Q1', 'simple upload (uploadType=media)', 'NO', `${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
  }

  // ── Q2: multipart upload (metadata + bytes, one request) ────────────────────
  {
    const boundary = 'adr103_multipart';
    const meta = { name: 'adr-103-multipart-probe.txt' };
    const media = Buffer.from('adr-103 multipart upload probe\n');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: text/plain\r\n\r\n`),
      media,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const url = uploadUrl(drive, filesCreate, 'simple', {}, { uploadType: 'multipart' });
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    const data = await res.json();
    if (res.ok && data.id) {
      created.push(data.id);
      record('Q2', 'multipart upload (metadata + bytes)', 'YES', `→ ${res.status}, id=${data.id}, name=${data.name}`);
    } else {
      record('Q2', 'multipart upload (metadata + bytes)', 'NO', `${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    }
  }

  // ── Q3: resumable — which path does Google actually serve? ──────────────────
  // Discovery declares `/resumable/upload/...`. Google's clients use
  // `/upload/...?uploadType=resumable`. Do not guess. Ask.
  {
    const payload = Buffer.from('adr-103 resumable probe\n'.repeat(64));

    const declaredUrl = uploadUrl(drive, filesCreate, 'resumable', {});
    const declared = await resumableUpload({
      initiateUrl: declaredUrl, token, contentType: 'text/plain', payload,
      metadata: { name: 'adr-103-resumable-declared.txt' }, chunkSize: 256 * 1024,
    });
    if (declared.ok) {
      created.push(declared.data.id);
      record('Q3a', 'resumable @ Discovery-DECLARED path', 'YES', `${declaredUrl} → ${declared.status}`);
    } else {
      record('Q3a', 'resumable @ Discovery-DECLARED path', 'NO',
        `${declaredUrl} → ${declared.status} (${declared.stage}) ${String(declared.body).slice(0, 120)}`);
    }

    const conventionUrl = uploadUrl(drive, filesCreate, 'simple', {}, { uploadType: 'resumable' });
    const convention = await resumableUpload({
      initiateUrl: conventionUrl, token, contentType: 'text/plain', payload,
      metadata: { name: 'adr-103-resumable-convention.txt' }, chunkSize: 256 * 1024,
    });
    if (convention.ok) {
      created.push(convention.data.id);
      record('Q3b', 'resumable @ /upload?uploadType=resumable', 'YES',
        `${conventionUrl} → ${convention.status}, ${convention.chunks} chunk(s), id=${convention.data.id}`);
    } else {
      record('Q3b', 'resumable @ /upload?uploadType=resumable', 'NO',
        `${conventionUrl} → ${convention.status} (${convention.stage}) ${String(convention.body).slice(0, 200)}`);
    }
  }

  // ── Q4: THE GATE — 35 MB Gmail attachment, chunked resumable ────────────────
  // Product behaviour: an attachment send is FORCED to --draft
  // (src/services/gmail/patch.ts:233). So the gate is drafts.create, which is
  // also what makes it reversible. Same media protocol, same maxSize (36700160).
  {
    const maxSize = Number(draftsCreate.mediaUpload.maxSize);   // 36700160 = 35 MiB
    // Size the raw attachment so the ENCODED rfc822 lands just under Google's cap.
    // base64 inflates 4/3, plus CRLF every 76 chars, plus headers.
    const rawBytes = 25_000_000;
    const attachment = Buffer.alloc(rawBytes);
    for (let i = 0; i < rawBytes; i += 4096) attachment.writeUInt32BE(i >>> 0, i); // non-compressible-ish

    const rfc822 = buildRfc822({
      from: EMAIL, to: EMAIL,
      subject: 'ADR-103 media upload spike — safe to delete',
      body: 'Generated by docs/design-notes/adr-103-media-upload-spike.mjs. Deleted automatically.',
      filename: 'adr-103-payload.bin', bytes: attachment, contentType: 'application/octet-stream',
    });

    console.log(`\n  attachment ${(rawBytes / 1e6).toFixed(1)} MB raw → rfc822 ${(rfc822.length / 1e6).toFixed(1)} MB ` +
                `(Google cap ${(maxSize / 1e6).toFixed(1)} MB, ${((rfc822.length / maxSize) * 100).toFixed(1)}% of it)`);
    if (rfc822.length > maxSize) {
      record('Q4', '35 MB Gmail attachment', 'NO', `payload ${rfc822.length} EXCEEDS declared maxSize ${maxSize}`);
    } else {
      // Use whichever resumable path Q3 proved. Prefer the convention if declared failed.
      const q3a = results.find(r => r.id === 'Q3a');
      const useDeclared = q3a?.verdict === 'YES';
      const initiateUrl = useDeclared
        ? uploadUrl(gmail, draftsCreate, 'resumable', { userId: 'me' })
        : uploadUrl(gmail, draftsCreate, 'simple', { userId: 'me' }, { uploadType: 'resumable' });

      const t0 = process.hrtime.bigint();
      const up = await resumableUpload({
        initiateUrl, token, contentType: 'message/rfc822', payload: rfc822,
        metadata: {}, chunkSize: 8 * 1024 * 1024,   // 8 MiB chunks → multi-chunk, real resumable
      });
      const secs = Number(process.hrtime.bigint() - t0) / 1e9;

      if (up.ok) {
        draftId = up.data.id;
        record('Q4', '35 MB Gmail attachment (chunked resumable)', 'YES',
          `${up.chunks} chunks, ${secs.toFixed(1)}s, draft id=${draftId}, message id=${up.data.message?.id}`);
      } else {
        record('Q4', '35 MB Gmail attachment (chunked resumable)', 'NO',
          `${up.status} (${up.stage}) after ${up.chunks} chunk(s): ${String(up.body).slice(0, 300)}`);
      }
    }
  }
} finally {
  // ── Cleanup: leave nothing behind. ─────────────────────────────────────────
  console.log('\ncleanup:');
  for (const id of created) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`  drive ${id} → ${res.status}`);
  }
  if (draftId) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`  gmail draft ${draftId} → ${res.status}`);
  }
}

console.log('\n──────── ADR-103 item 4 ────────');
for (const r of results) console.log(`${r.verdict.padEnd(4)}  ${r.id}  ${r.question}`);
const failed = results.filter(r => r.verdict === 'NO');
const gate = results.find(r => r.id === 'Q4');
console.log(`\nGATE (35 MB attachment): ${gate?.verdict ?? 'NOT REACHED'}`);
process.exit(gate?.verdict === 'YES' ? 0 : 1);
