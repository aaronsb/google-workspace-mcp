/**
 * The API descriptor: a generated, committed transcription of Google's Discovery
 * documents, pruned to what making a REQUEST needs.
 *
 * Generated at BUILD time by `scripts/generate-descriptor.mjs` and committed, so
 * there is no network dependency at startup and nothing breaks offline. Drift is a
 * CI check, not a production surprise.
 *
 * It records what Discovery says about how to CALL Google. It records nothing
 * about what a RESPONSE means — Discovery's `schemas` block (~90% of the raw
 * document) is discarded, with ONE exception. A descriptor that knows response
 * shapes is a descriptor that can start helpfully reshaping them.
 *
 * The exception is enum VALUES, taken from schema properties and method parameters
 * alike (`enums` below, and `ApiParam.enum`). They describe what may go into a
 * request, not what comes back, so they do not open the reshaping door. Without
 * them a handler that builds a request body is checked by nothing here: a handler
 * sending `MODERATION_ON` where Google wanted `ON` passed lint, type-check and the
 * whole suite, and was found only by calling Google.
 *
 * See ADR-103.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ApiParam {
  location: 'path' | 'query';
  required?: boolean;
  repeated?: boolean;
  /** The values Google accepts, when it constrains them. Calendar declares its enums here. */
  enum?: string[];
}

export interface ApiMediaUpload {
  maxSize?: string;
  accept?: string[];
  simple?: string;
  resumable?: string;
}

export interface ApiMethod {
  path: string;
  httpMethod: string;
  parameters: Record<string, ApiParam>;
  scopes?: string[];
  supportsMediaDownload?: boolean;
  mediaUpload?: ApiMediaUpload;
}

export interface ApiService {
  version: string;
  rootUrl: string;
  servicePath: string;
  discoveryUrl: string;
  /** `fields`, `alt`, `quotaUser`… declared once at the document root, not per method. */
  globalParameters: Record<string, ApiParam>;
  methods: Record<string, ApiMethod>;
  /**
   * Enum values from Discovery's schema properties, keyed `SchemaName.field` —
   * e.g. `SpaceConfig.moderation`. This is where REQUEST-BODY enums live, which method
   * parameters cannot express.
   */
  enums: Record<string, string[]>;
}

export interface ApiDescriptor {
  generatedFrom: string;
  services: Record<string, ApiService>;
}

let cached: ApiDescriptor | undefined;

/**
 * Load the descriptor. Resolved as a sibling of this module, which makes it work
 * under `src/` (vitest) and under `build/` (the shipped server) alike — the same
 * trick `loadManifest()` uses, and the reason `npx` works.
 */
export async function loadDescriptor(): Promise<ApiDescriptor> {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = await readFile(resolve(here, 'descriptor.json'), 'utf-8');
  cached = JSON.parse(raw) as ApiDescriptor;
  return cached;
}

/** Tests only: drop the memoised descriptor. */
export function resetDescriptorCache(): void {
  cached = undefined;
}
