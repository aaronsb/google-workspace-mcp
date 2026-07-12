/**
 * THE MINER (ADR-103, rehearsal shape).
 *
 * Google Discovery -> a distilled CONTRACT. Runs at BUILD time; its output is a
 * committed artifact. Nothing here runs at runtime, and nothing here touches an
 * account — it reads public documents.
 *
 * This is the piece that replaces gws. gws is someone else's miner wrapped in
 * the product baggage of being an operational CLI; we want the miner.
 *
 * THE ONE RULE: the contract is a TRANSCRIPTION, not an interpretation.
 * It records what Discovery says about how to make a REQUEST. It records nothing
 * about what a RESPONSE means. That is why ~90% of each Discovery doc — the
 * `schemas` block, which defines response shapes — is deliberately DISCARDED.
 * A contract that knows response shapes is a contract that can start helpfully
 * reshaping them, and that is the defect class ADR-101 spent six rounds learning
 * to fear: something that can be subtly wrong in a way no test catches.
 *
 * Measured: 983 KB of raw Discovery across 7 services -> 94 KB of contract,
 * covering all 233 methods. (The gws binary it replaces is 19.2 MB.) Mining the
 * WHOLE surface therefore costs nothing, which is what lets us validate the
 * manifest against Google's real surface instead of against gws's.
 */

const DIRECTORY = 'https://www.googleapis.com/discovery/v1/apis';

/**
 * The services and versions our manifest targets. This is the ONE thing we must
 * state; everything else is asked.
 */
export const SERVICE_VERSIONS = {
  gmail: 'v1', drive: 'v3', calendar: 'v3', docs: 'v1',
  sheets: 'v4', tasks: 'v1', meet: 'v2',
};

/**
 * Where does a service's Discovery document live?
 *
 * NOT a template. Measured, across the seven services we use:
 *
 *   service                         central endpoint   self-hosted
 *   gmail, docs, sheets, tasks      200                200
 *   drive, calendar                 200                404
 *   meet                            404                200
 *
 * Neither pattern is universal, so ANY URL TEMPLATE IS A GUESS. The directory
 * publishes a `discoveryRestUrl` per API, and Calendar is the proof this matters:
 * it lives at `calendar-json.googleapis.com`, which no template would produce.
 *
 * Look the document up. Do not construct its address.
 */
export async function resolveDiscoveryUrls(fetchImpl = fetch) {
  const res = await fetchImpl(DIRECTORY);
  if (!res.ok) throw new Error(`discovery directory: ${res.status}`);
  const { items } = await res.json();

  const urls = {};
  for (const [service, version] of Object.entries(SERVICE_VERSIONS)) {
    const hit = items.find((i) => i.name === service && i.version === version);
    if (!hit) throw new Error(`${service}/${version} is not in the Discovery directory`);
    urls[service] = hit.discoveryRestUrl;
  }
  return urls;
}

/**
 * Distil ONE method. Request-side facts only.
 *
 * Kept:  path, httpMethod, parameter locations, required-ness, scopes, media.
 * Dropped: `response`, `request` ($ref into schemas) — response shape is not our
 *          business, and `request` body shape is validated by Google, not by us.
 */
function distillMethod(m) {
  const parameters = {};
  for (const [name, p] of Object.entries(m.parameters ?? {})) {
    parameters[name] = {
      location: p.location,
      ...(p.required ? { required: true } : {}),
      ...(p.repeated ? { repeated: true } : {}),
    };
  }

  const out = { path: m.path, httpMethod: m.httpMethod, parameters };
  if (m.scopes) out.scopes = m.scopes;                              // item 8 falls out free
  if (m.supportsMediaDownload) out.supportsMediaDownload = true;
  if (m.supportsMediaUpload) {
    // Discovery declares the upload PATHS, for both protocols. Item 4 proved
    // both are served. Transcribe them; do not reconstruct them.
    out.mediaUpload = {
      maxSize: m.mediaUpload?.maxSize,
      accept: m.mediaUpload?.accept,
      simple: m.mediaUpload?.protocols?.simple?.path,
      resumable: m.mediaUpload?.protocols?.resumable?.path,
    };
  }
  return out;
}

/** Walk resources -> methods into flat dotted keys: `users.messages.attachments.get`. */
function walkMethods(node, prefix, out) {
  for (const [name, m] of Object.entries(node.methods ?? {})) {
    out[prefix ? `${prefix}.${name}` : name] = distillMethod(m);
  }
  for (const [name, child] of Object.entries(node.resources ?? {})) {
    walkMethods(child, prefix ? `${prefix}.${name}` : name, out);
  }
  return out;
}

/** Mine every service in SERVICE_VERSIONS into one contract object. */
export async function mine(fetchImpl = fetch) {
  const urls = await resolveDiscoveryUrls(fetchImpl);
  const services = {};

  for (const [service, version] of Object.entries(SERVICE_VERSIONS)) {
    const res = await fetchImpl(urls[service]);
    if (!res.ok) throw new Error(`discovery ${service}/${version} at ${urls[service]}: ${res.status}`);
    const doc = await res.json();

    // Global parameters are declared ONCE, at the document root — not per method.
    // `fields`, `alt`, `quotaUser`, `prettyPrint`… A dispatcher that reads only
    // method.parameters cannot place them, drops them into the body, and a GET
    // silently discards them. That is how drive.listComments died with
    // "The 'fields' parameter is required". Transcribe them; the client merges.
    const globalParameters = {};
    for (const [name, p] of Object.entries(doc.parameters ?? {})) {
      globalParameters[name] = { location: p.location };
    }

    services[service] = {
      version: doc.version,
      rootUrl: doc.rootUrl,
      servicePath: doc.servicePath ?? '',
      discoveryUrl: urls[service],
      globalParameters,
      methods: walkMethods(doc, '', {}),
    };
  }

  return { minedFrom: DIRECTORY, services };
}
