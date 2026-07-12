/**
 * Where does a param actually LAND — path, query, or request body?
 *
 * Before ADR-103 a patch test could read that off the command line: a param in
 * `--json` was the body, a param in `--params` was the query, and a test could
 * assert "name goes in the body, NOT the query" by inspecting argv. The client
 * has no command line. It splits params by what the DESCRIPTOR declares, inside
 * `buildRequest`, so a mocked `call()` sees one flat params object and the split
 * is invisible to the caller.
 *
 * Those placement assertions are the ones that caught real bugs (a `name` that
 * leaked into the query silently did nothing, and copies kept coming back named
 * "Copy of X"). So rather than drop them, this runs the REAL `buildRequest`
 * against the REAL descriptor — checking placement against what Google actually
 * declares, which is strictly stronger than what argv could tell us.
 */
import { vi } from 'vitest';

import { loadDescriptor } from '../../google/descriptor.js';
import type { BuiltRequest } from '../../google/client.js';

type ClientModule = typeof import('../../google/client.js');

/**
 * Build the HTTP request the client WOULD have made for a recorded `call()`.
 * Uses `importActual` so it works in files where the client module is mocked.
 */
export async function requestFor(
  service: string,
  resourcePath: string,
  params: Record<string, unknown>,
): Promise<BuiltRequest> {
  const actual = await vi.importActual<ClientModule>('../../google/client.js');
  return actual.buildRequest(await loadDescriptor(), service, resourcePath, params);
}

/** The query string of a built request, as a plain object. */
export function queryOf(request: BuiltRequest): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}
