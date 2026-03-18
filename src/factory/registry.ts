/**
 * Shared factory registry — single instance of manifest + generated tools.
 * Both handler.ts and tools.ts import from here instead of loading independently.
 */

import { loadManifest, generateTools } from './generator.js';
import { patches } from './patches.js';
import type { GeneratedTool } from './types.js';
import type { Manifest } from './types.js';

export const manifest: Manifest = loadManifest();
export const generatedTools: GeneratedTool[] = generateTools(manifest, patches);
