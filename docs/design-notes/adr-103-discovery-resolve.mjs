/**
 * ADR-103: resolving a service to its Discovery document.
 *
 * The naive assumption — that every API lives at
 *   https://www.googleapis.com/discovery/v1/apis/{service}/{version}/rest
 * — is FALSE. Meet 404s there. The equally naive fix — that every API self-hosts at
 *   https://{service}.googleapis.com/$discovery/rest?version={v}
 * — is ALSO false. Drive and Calendar 404 there.
 *
 * Measured, all 7 services we use:
 *
 *   service      central   self-hosted
 *   gmail/v1     200       200
 *   drive/v3     200       404
 *   calendar/v3  200       404
 *   docs/v1      200       200
 *   sheets/v4    200       200
 *   tasks/v1     200       200
 *   meet/v2      404       200
 *
 * Neither pattern is universal, so a URL TEMPLATE IS A GUESS. The authoritative
 * answer is the Discovery *directory*, which publishes a `discoveryRestUrl` per
 * API. Calendar is the proof that this matters — it lives at
 * `calendar-json.googleapis.com`, which no template would ever produce.
 *
 * So the miner's entry point is the directory. This keeps the "no interpretation"
 * principle intact: we do not know where the docs are, we ASK.
 */

const DIRECTORY = 'https://www.googleapis.com/discovery/v1/apis';

let directoryCache = null;
const docCache = new Map();

/** Fetch the directory once: 517 APIs, each with its own discoveryRestUrl. */
export async function loadDirectory() {
  if (directoryCache) return directoryCache;
  const res = await fetch(DIRECTORY);
  if (!res.ok) throw new Error(`discovery directory: ${res.status}`);
  directoryCache = (await res.json()).items;
  return directoryCache;
}

/** name+version -> the URL Google says the document lives at. No template, no guess. */
export async function resolveDiscoveryUrl(service, version) {
  const items = await loadDirectory();
  const hit = items.find((i) => i.name === service && i.version === version);
  if (!hit) throw new Error(`${service}/${version} is not in the Discovery directory`);
  return hit.discoveryRestUrl;
}

export async function loadDiscovery(service, version) {
  const key = `${service}/${version}`;
  if (docCache.has(key)) return docCache.get(key);
  const url = await resolveDiscoveryUrl(service, version);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`discovery ${key} at ${url}: ${res.status}`);
  const doc = await res.json();
  docCache.set(key, doc);
  return doc;
}

/** Walk `conferenceRecords.transcripts.entries.list` structurally. No judgement. */
export function resolveMethod(doc, resourcePath) {
  const parts = resourcePath.split('.');
  const method = parts.pop();
  let node = doc;
  for (const p of parts) {
    node = node?.resources?.[p];
    if (!node) return null;
  }
  return node?.methods?.[method] ?? null;
}

/** The versions our manifest targets. The one thing we must state; everything else is asked. */
export const SERVICE_VERSIONS = {
  gmail: 'v1', drive: 'v3', calendar: 'v3', docs: 'v1',
  sheets: 'v4', tasks: 'v1', meet: 'v2',
};
