/**
 * THE CLIENT (ADR-103, rehearsal shape).
 *
 * descriptor + params -> HTTP request -> RAW Google JSON, untouched.
 *
 * This is what replaces `spawn(gws)`. It is the whole of what gws did for
 * resource operations: get a token, make the call, hand back the JSON.
 *
 * LOAD-BEARING CONSTRAINT: this layer has NO OPINIONS. It never reshapes, never
 * "fixes", never fills in. It returns exactly what Google returned, error or not.
 * Interpretation happens ABOVE it, in the layer we already own and aim at the MCP
 * descriptor (patches / formatters / next-steps). The moment this file gets helpful,
 * it becomes something that can be subtly wrong in a way no test catches.
 *
 * Everything below is a consequence of something the DESCRIPTOR said. Where a rule
 * looks arbitrary, it is not — it is a fact we learned by being wrong first.
 */

export class GoogleApiError extends Error {
  constructor(status, body, request) {
    // Google's real error JSON, not scraped stderr. This is one of the things
    // retiring gws BUYS us (ADR-103, item 7).
    const msg = body?.error?.message ?? `HTTP ${status}`;
    super(msg);
    this.name = 'GoogleApiError';
    this.status = status;
    this.body = body;
    this.request = request;
    this.reason = body?.error?.errors?.[0]?.reason;
  }
}

function resolveMethod(descriptor, service, resourcePath) {
  const svc = descriptor.services[service];
  if (!svc) throw new Error(`descriptor has no service '${service}'`);
  const m = svc.methods[resourcePath];
  if (!m) throw new Error(`descriptor has no method '${service}.${resourcePath}'`);
  return { svc, m };
}

/**
 * Expand a Discovery path template.
 *
 * `{+var}` is RFC 6570 RESERVED expansion — reserved characters, notably `/`,
 * must NOT be percent-encoded. Meet's identifiers ARE paths
 * ("conferenceRecords/abc"), so encoding that slash to %2F 404s every Meet
 * sub-resource operation. The `+` is the document telling us this. Honour it.
 */
function expandPath(template, pathParams) {
  return template.replace(/\{(\+?)([^}]+)\}/g, (_, reserved, name) => {
    if (!(name in pathParams)) throw new Error(`missing required path param '${name}'`);
    const raw = String(pathParams[name]);
    return reserved
      ? raw.split('/').map(encodeURIComponent).join('/')
      : encodeURIComponent(raw);
  });
}

/**
 * Split params into path / query / body, purely by what the descriptor DECLARES.
 * Anything the descriptor does not declare is a body member — that is the schema's
 * business, not ours, and Google validates it.
 */
function splitParams(svc, m, params) {
  // Method params win over global ones on a name collision.
  const declared = { ...svc.globalParameters, ...m.parameters };
  const path = {}, query = {}, body = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const loc = declared[k]?.location;
    if (loc === 'path') path[k] = v;
    else if (loc === 'query') query[k] = v;
    else body[k] = v;
  }
  return { path, query, body };
}

function withQuery(url, query) {
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else url.searchParams.set(k, String(v));
  }
  return url;
}

/** Build the request the descriptor describes. Pure — no I/O, so it is testable offline. */
export function buildRequest(descriptor, service, resourcePath, params = {}) {
  const { svc, m } = resolveMethod(descriptor, service, resourcePath);
  const { path, query, body } = splitParams(svc, m, params);

  const base = svc.rootUrl.replace(/\/$/, '') + '/' + (svc.servicePath ?? '').replace(/^\//, '');
  const url = withQuery(
    new URL((base.replace(/\/$/, '') + '/' + expandPath(m.path, path)).replace(/\/+$/, '')),
    query,
  );

  const hasBody = Object.keys(body).length > 0 && m.httpMethod !== 'GET';
  return {
    url: url.toString(),
    method: m.httpMethod,
    body: hasBody ? body : undefined,
    scopes: m.scopes,
    mediaUpload: m.mediaUpload,
  };
}

/** Execute. Returns raw Google JSON. Throws GoogleApiError with Google's real error body. */
export async function call(descriptor, service, resourcePath, params, { token, fetchImpl = fetch } = {}) {
  const req = buildRequest(descriptor, service, resourcePath, params);
  const res = await fetchImpl(req.url, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(req.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(req.body ? { body: JSON.stringify(req.body) } : {}),
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; }
  catch { throw new GoogleApiError(res.status, { error: { message: text.slice(0, 300) } }, req); }

  if (!res.ok) throw new GoogleApiError(res.status, json, req);
  return json;   // NO interpretation. Exactly what Google returned.
}

/**
 * Media upload. The descriptor carries the upload paths for BOTH protocols,
 * because Discovery DECLARES them — item 4 verified that both are served, and
 * that a 35 MB Gmail attachment round-trips byte-for-byte through the resumable
 * one. The upload path is root-relative, so resolving it against rootUrl is the
 * entire algorithm.
 */
export async function upload(descriptor, service, resourcePath, params, {
  token, media, contentType, metadata = {}, chunkSize = 8 * 1024 * 1024, fetchImpl = fetch,
} = {}) {
  const { svc, m } = resolveMethod(descriptor, service, resourcePath);
  if (!m.mediaUpload) throw new Error(`${service}.${resourcePath} does not support media upload`);

  const max = Number(m.mediaUpload.maxSize);
  if (max && media.length > max) {
    throw new Error(`payload ${media.length}B exceeds Google's declared maxSize ${max}B for ${service}.${resourcePath}`);
  }

  const { path, query } = splitParams(svc, m, params);
  const initiate = withQuery(
    new URL(expandPath(m.mediaUpload.resumable ?? m.mediaUpload.simple, path), svc.rootUrl),
    { ...query, uploadType: 'resumable' },
  );

  const init = await fetchImpl(initiate.toString(), {
    method: m.httpMethod,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType,
      'X-Upload-Content-Length': String(media.length),
    },
    body: JSON.stringify(metadata),
  });
  if (!init.ok) {
    const t = await init.text();
    throw new GoogleApiError(init.status, safeJson(t), { stage: 'initiate', url: initiate.toString() });
  }
  const session = init.headers.get('location');
  if (!session) throw new Error('resumable initiate returned no Location header');

  // Chunked PUTs. Non-final chunks must be a multiple of 256 KiB; 308 means
  // "Resume Incomplete" — the protocol working, not an error.
  let offset = 0;
  while (offset < media.length) {
    const end = Math.min(offset + chunkSize, media.length);
    const res = await fetchImpl(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${media.length}` },
      body: media.subarray(offset, end),
    });
    if (res.status === 308) { offset = end; continue; }
    const text = await res.text();
    if (!res.ok) throw new GoogleApiError(res.status, safeJson(text), { stage: `chunk@${offset}` });
    return safeJson(text) ?? {};
  }
  throw new Error('media consumed without a terminal response');
}

function safeJson(t) { try { return t ? JSON.parse(t) : {}; } catch { return { error: { message: String(t).slice(0, 300) } }; } }
