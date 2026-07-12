/**
 * The Google API client.
 *
 * The whole of a resource operation: get a token, make the call, hand back the JSON.
 *
 * LOAD-BEARING CONSTRAINT — this layer has NO OPINIONS. It never reshapes, never
 * "fixes", never fills in. It returns exactly what Google returned. Interpretation
 * happens ABOVE it, in the layer we already own and aim at the MCP contract
 * (patches / formatters / next-steps). The moment this file gets helpful, it
 * becomes something that can be subtly wrong in a way no test catches — the exact
 * defect class ADR-101 spent six review rounds learning to fear.
 *
 * Everything here is a consequence of something the DESCRIPTOR said. Where a rule
 * looks arbitrary, it is not: it is a fact we learned by being wrong first, live,
 * against Google (ADR-103, item 2).
 *
 * See ADR-103.
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { getAccessToken } from '../accounts/token-service.js';
import { GoogleApiError, type GoogleErrorBody } from './errors.js';
import { loadDescriptor, type ApiDescriptor, type ApiMethod } from './descriptor.js';
import type { GoogleService, ServiceMethods } from './methods.js';

export interface CallOptions {
  /** Account email — the token is minted for this identity. */
  account: string;
  descriptor?: ApiDescriptor;
  fetchImpl?: typeof fetch;
}

function resolve(descriptor: ApiDescriptor, service: string, resourcePath: string): {
  svc: ApiDescriptor['services'][string];
  method: ApiMethod;
} {
  const svc = descriptor.services[service];
  if (!svc) throw new Error(`descriptor has no service '${service}'`);
  const method = svc.methods[resourcePath];
  if (!method) throw new Error(`descriptor has no method '${service}.${resourcePath}'`);
  return { svc, method };
}

/**
 * Expand a path template.
 *
 * `{+var}` is RFC 6570 RESERVED expansion — reserved characters, notably `/`,
 * must NOT be percent-encoded. Meet's identifiers ARE paths
 * ("conferenceRecords/abc"), so encoding that slash to %2F 404s every Meet
 * sub-resource operation. The `+` is the descriptor telling us this. Honour it.
 */
function expandPath(template: string, pathParams: Record<string, unknown>): string {
  return template.replace(/\{(\+?)([^}]+)\}/g, (_m, reserved: string, name: string) => {
    if (!(name in pathParams)) throw new Error(`missing required path param '${name}'`);
    const raw = String(pathParams[name]);
    return reserved
      ? raw.split('/').map(encodeURIComponent).join('/')
      : encodeURIComponent(raw);
  });
}

/**
 * Split params into path / query / body by what the descriptor DECLARES.
 *
 * Global parameters (`fields`, `alt`, `quotaUser`, `prettyPrint`) are declared
 * ONCE at the document root, not per method. A dispatcher that consults only the
 * method's parameters cannot place `fields`, drops it into the body, and a GET
 * silently discards it — which is exactly how drive.listComments died with
 * "The 'fields' parameter is required". Merge both; the method wins on conflict.
 */
function splitParams(
  svc: ApiDescriptor['services'][string],
  method: ApiMethod,
  params: Record<string, unknown>,
): { path: Record<string, unknown>; query: Record<string, unknown>; body: Record<string, unknown> } {
  const declared = { ...svc.globalParameters, ...method.parameters };
  const path: Record<string, unknown> = {};
  const query: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const location = declared[key]?.location;
    if (location === 'path') path[key] = value;
    else if (location === 'query') query[key] = value;
    else body[key] = value;      // undeclared -> request body; Google validates it, not us
  }
  return { path, query, body };
}

function applyQuery(url: URL, query: Record<string, unknown>): URL {
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
    else url.searchParams.set(key, String(value));
  }
  return url;
}

export interface BuiltRequest {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

/** Pure: descriptor + params -> the request. No I/O, so it is testable offline. */
export function buildRequest(
  descriptor: ApiDescriptor,
  service: string,
  resourcePath: string,
  params: Record<string, unknown> = {},
): BuiltRequest {
  const { svc, method } = resolve(descriptor, service, resourcePath);
  const { path, query, body } = splitParams(svc, method, params);

  const base = svc.rootUrl.replace(/\/$/, '') + '/' + svc.servicePath.replace(/^\//, '');
  const url = applyQuery(
    new URL((base.replace(/\/$/, '') + '/' + expandPath(method.path, path)).replace(/\/+$/, '')),
    query,
  );

  const hasBody = Object.keys(body).length > 0 && method.httpMethod !== 'GET';
  return { url: url.toString(), method: method.httpMethod, body: hasBody ? body : undefined };
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: { message: text.slice(0, 300) } }; }
}

/**
 * Call a Google API method. Returns RAW Google JSON — no envelope, no reshaping.
 * Throws GoogleApiError carrying Google's real error body.
 */
export async function call<S extends GoogleService>(
  service: S,
  resourcePath: ServiceMethods[S],
  params: Record<string, unknown>,
  options: CallOptions,
): Promise<unknown> {
  const descriptor = options.descriptor ?? await loadDescriptor();
  const doFetch = options.fetchImpl ?? fetch;
  const request = buildRequest(descriptor, service, resourcePath, params);
  const token = await getAccessToken(options.account);

  const response = await doFetch(request.url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });

  const text = await response.text();
  const json = parseJson(text);
  if (!response.ok) {
    throw new GoogleApiError(response.status, json as GoogleErrorBody, {
      url: request.url,
      method: request.method,
    });
  }
  return json;
}

/**
 * Download media to disk.
 *
 * STREAMED, deliberately. The bytes go from the socket to the file and are never a
 * string at all. Never buffer a download through an in-memory string: accumulating
 * the whole response and JSON.parse-ing it turns a 30 MB attachment into a ~40 MB
 * string, then an object, then a Buffer — uncapped, for every download.
 */
export async function download<S extends GoogleService>(
  service: S,
  resourcePath: ServiceMethods[S],
  params: Record<string, unknown>,
  outputPath: string,
  options: CallOptions,
): Promise<string> {
  const descriptor = options.descriptor ?? await loadDescriptor();
  const doFetch = options.fetchImpl ?? fetch;
  const request = buildRequest(descriptor, service, resourcePath, params);
  const token = await getAccessToken(options.account);

  const response = await doFetch(request.url, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const json = parseJson(await response.text());
    throw new GoogleApiError(response.status, json as GoogleErrorBody, {
      url: request.url,
      method: request.method,
    });
  }
  if (!response.body) throw new Error(`no response body for ${service}.${resourcePath}`);

  await mkdir(dirname(outputPath), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(outputPath));
  return outputPath;
}

export interface UploadOptions extends CallOptions {
  media: Buffer;
  contentType: string;
  metadata?: Record<string, unknown>;
  /** Non-final chunks must be a multiple of 256 KiB. */
  chunkSize?: number;
}

/**
 * Resumable, chunked media upload.
 *
 * The descriptor carries the upload paths for both protocols because Discovery
 * DECLARES them. Verified live (ADR-103 item 4): a 25 MB attachment — 34.2 MB as
 * RFC822, 93% of Google's declared 36,700,160-byte cap — uploaded in 5 chunks and
 * read back byte-for-byte identical.
 */
export async function upload<S extends GoogleService>(
  service: S,
  resourcePath: ServiceMethods[S],
  params: Record<string, unknown>,
  options: UploadOptions,
): Promise<unknown> {
  const descriptor = options.descriptor ?? await loadDescriptor();
  const doFetch = options.fetchImpl ?? fetch;
  const { svc, method } = resolve(descriptor, service, resourcePath);
  if (!method.mediaUpload) throw new Error(`${service}.${resourcePath} does not support media upload`);

  // Google DECLARES the ceiling. Refusing locally beats a confusing 400 from a
  // 35 MB request that already crossed the wire.
  const max = Number(method.mediaUpload.maxSize);
  if (max && options.media.length > max) {
    throw new Error(
      `${service}.${resourcePath}: payload is ${options.media.length} bytes; ` +
      `Google's declared limit is ${max} bytes`,
    );
  }

  const token = await getAccessToken(options.account);
  const { path, query } = splitParams(svc, method, params);
  const uploadPath = method.mediaUpload.resumable ?? method.mediaUpload.simple;
  if (!uploadPath) throw new Error(`${service}.${resourcePath} declares no upload protocol`);

  const initiateUrl = applyQuery(
    new URL(expandPath(uploadPath, path), svc.rootUrl),
    { ...query, uploadType: 'resumable' },
  ).toString();

  const initiate = await doFetch(initiateUrl, {
    method: method.httpMethod,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': options.contentType,
      'X-Upload-Content-Length': String(options.media.length),
    },
    body: JSON.stringify(options.metadata ?? {}),
  });
  if (!initiate.ok) {
    const json = parseJson(await initiate.text());
    throw new GoogleApiError(initiate.status, json as GoogleErrorBody, { url: initiateUrl, method: method.httpMethod });
  }

  const session = initiate.headers.get('location');
  if (!session) throw new Error('resumable upload: initiate returned no Location header');

  const chunkSize = options.chunkSize ?? 8 * 1024 * 1024;
  let offset = 0;
  while (offset < options.media.length) {
    const end = Math.min(offset + chunkSize, options.media.length);
    const response = await doFetch(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${options.media.length}` },
      body: options.media.subarray(offset, end) as unknown as BodyInit,
    });

    // 308 "Resume Incomplete" is the protocol working, not an error.
    if (response.status === 308) { offset = end; continue; }

    const text = await response.text();
    if (!response.ok) {
      throw new GoogleApiError(response.status, parseJson(text) as GoogleErrorBody, { url: session, method: 'PUT' });
    }
    return parseJson(text);
  }
  throw new Error('resumable upload: media consumed without a terminal response');
}
