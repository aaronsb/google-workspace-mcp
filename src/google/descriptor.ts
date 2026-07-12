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
 * document) is deliberately DISCARDED. A descriptor that knows response shapes is
 * a descriptor that can start helpfully reshaping them.
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
