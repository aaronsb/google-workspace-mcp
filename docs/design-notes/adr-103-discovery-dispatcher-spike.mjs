/**
 * SPIKE: a mechanical Discovery dispatcher. No interpretation, no fixing.
 * Discovery doc in → HTTP call out → raw Google JSON returned untouched.
 *
 * The entire hypothesis: this reproduces gws's output for resource-style ops,
 * because gws is a pass-through for them. If true, gws's remaining value is
 * CLI-audience interpretation we deliberately do NOT want.
 */
const docCache = new Map();

export async function loadDiscovery(service, version) {
  const key = `${service}/${version}`;
  if (docCache.has(key)) return docCache.get(key);
  const res = await fetch(`https://www.googleapis.com/discovery/v1/apis/${service}/${version}/rest`);
  if (!res.ok) throw new Error(`discovery ${key}: ${res.status}`);
  const doc = await res.json();
  docCache.set(key, doc);
  return doc;
}

/** Walk `users.messages.list` through doc.resources.*.methods — purely structural. */
function resolveMethod(doc, resourcePath) {
  const parts = resourcePath.split('.');
  const method = parts.pop();
  let node = doc;
  for (const p of parts) {
    node = node.resources?.[p];
    if (!node) throw new Error(`no resource '${p}' in ${resourcePath}`);
  }
  const m = node.methods?.[method];
  if (!m) throw new Error(`no method '${method}' in ${resourcePath}`);
  return m;
}

/**
 * Build the request EXACTLY as the discovery doc declares. The doc says which
 * params are path vs query; everything else is the request body. That is the
 * whole algorithm — there is no judgement in it.
 */
export function buildRequest(doc, resourcePath, params = {}) {
  const m = resolveMethod(doc, resourcePath);
  const declared = m.parameters ?? {};

  const pathParams = {};
  const queryParams = {};
  const body = {};

  for (const [k, v] of Object.entries(params)) {
    const loc = declared[k]?.location;
    if (loc === 'path') pathParams[k] = v;
    else if (loc === 'query') queryParams[k] = v;
    else body[k] = v;                     // undeclared → request body (per the schema)
  }

  let path = m.path.replace(/\{\+?([^}]+)\}/g, (_, name) => {
    if (!(name in pathParams)) throw new Error(`missing path param '${name}' for ${resourcePath}`);
    return encodeURIComponent(String(pathParams[name]));
  });

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(queryParams)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
    else qs.append(k, String(v));
  }

  // rootUrl + servicePath + path — all three are DECLARED by the doc. Gmail ships an
  // empty servicePath (its path already carries 'gmail/v1/'); Drive ships 'drive/v3/'
  // with path 'files'. Read the doc; do not assume.
  const base = doc.rootUrl.replace(/\/$/, '') + '/' + (doc.servicePath ?? '').replace(/^\//, '');
  const url = (base.replace(/\/$/, '') + '/' + path).replace(/([^:]);\/+/g, '$1/') + (qs.toString() ? `?${qs}` : '');
  const hasBody = Object.keys(body).length > 0 && m.httpMethod !== 'GET';
  return { url, method: m.httpMethod, body: hasBody ? body : undefined, supportsMediaUpload: !!m.supportsMediaUpload };
}

export async function call(service, version, resourcePath, params, accessToken) {
  const doc = await loadDiscovery(service, version);
  const req = buildRequest(doc, resourcePath, params);
  const res = await fetch(req.url, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(req.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(req.body ? { body: JSON.stringify(req.body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  // NO interpretation: return exactly what Google returned, error or not.
  return { ok: res.ok, status: res.status, data: json, request: req };
}
