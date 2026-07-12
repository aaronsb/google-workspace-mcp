/**
 * Discover Google's API surface — from Google, not from a CLI's help text.
 *
 * This module used to shell out to the gws binary and reconstruct the API surface
 * by REGEX-SCRAPING `--help` output:
 *
 *     const resourceMatch = trimmed.match(/^(\w+)\s+Operations on the/);
 *     const methodMatch   = trimmed.match(/^(\w+)\s+\S/);
 *
 * That is API truth derived from human-readable PROSE, and it produced exactly the
 * defect you would expect. `calendars.The` — a word captured out of a wrapped
 * description line — was recorded in coverage-baseline.json as an uncovered "gap":
 * a method that does not exist, offered to future contributors as work they could
 * pick up. Nothing caught it, because the scraper's only source of truth was
 * typography.
 *
 * It also measured us against the WRONG SURFACE. The denominator was gws's: it
 * counted gws's 12 helper INVENTIONS (which are not Google operations at all),
 * that scraping phantom, and five services we deliberately do not support. Our
 * headline "72/350 (21%)" was partly fiction.
 *
 * Now: we ask Google. The descriptor records where each service's Discovery
 * document lives (which cannot be templated — Calendar is served from
 * `calendar-json.googleapis.com`), so we look it up and read it.
 *
 * WHY FETCH RATHER THAN READ THE DESCRIPTOR: the committed descriptor is
 * deliberately structure-only — no descriptions — because it ships at RUNTIME and
 * descriptions would add +162 KB to every install for text no server ever reads.
 * Coverage is a DEV command. It can afford the network, and it needs the prose to
 * make "the frontier" actionable.
 *
 * See ADR-103, verification item 11.
 */
import { loadDescriptor } from '../google/descriptor.js';
import type {
  DiscoveredParam,
  DiscoveredOperation,
  DiscoveredService,
  DiscoveredSurface,
} from './types.js';

/** A Discovery method, as Google publishes it. */
interface DiscoveryMethod {
  path: string;
  httpMethod: string;
  description?: string;
  parameters?: Record<string, {
    type?: string;
    description?: string;
    required?: boolean;
    default?: unknown;
    enum?: string[];
    deprecated?: boolean;
  }>;
}

interface DiscoveryNode {
  methods?: Record<string, DiscoveryMethod>;
  resources?: Record<string, DiscoveryNode>;
}

/** Flatten resources -> methods into dotted keys: `users.messages.attachments.get`. */
function walkMethods(node: DiscoveryNode, prefix: string, out: Record<string, DiscoveryMethod>): Record<string, DiscoveryMethod> {
  for (const [name, method] of Object.entries(node.methods ?? {})) {
    out[prefix ? `${prefix}.${name}` : name] = method;
  }
  for (const [name, child] of Object.entries(node.resources ?? {})) {
    walkMethods(child, prefix ? `${prefix}.${name}` : name, out);
  }
  return out;
}

function toParams(method: DiscoveryMethod): Record<string, DiscoveredParam> {
  const params: Record<string, DiscoveredParam> = {};
  for (const [name, p] of Object.entries(method.parameters ?? {})) {
    params[name] = {
      type: p.type ?? 'string',
      description: p.description ?? '',
      required: p.required === true,
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(p.enum ? { enum: p.enum } : {}),
      ...(p.deprecated ? { deprecated: true } : {}),
    };
  }
  return params;
}

/**
 * Read Google's real surface for every service the descriptor knows about.
 *
 * There is no `helpers` concept any more — that was gws's, and gws is gone. An
 * operation is a Google method or it does not exist.
 */
export async function discoverSurface(): Promise<DiscoveredSurface> {
  const descriptor = await loadDescriptor();
  const services: Record<string, DiscoveredService> = {};

  for (const [serviceName, service] of Object.entries(descriptor.services)) {
    process.stderr.write(`[coverage] reading ${serviceName} from Google...\n`);

    const response = await fetch(service.discoveryUrl);
    if (!response.ok) {
      throw new Error(
        `[coverage] could not read Discovery for ${serviceName} at ${service.discoveryUrl}: ${response.status}`,
      );
    }
    const doc = await response.json() as DiscoveryNode;

    const operations: Record<string, DiscoveredOperation> = {};
    for (const [resourcePath, method] of Object.entries(walkMethods(doc, '', {}))) {
      operations[resourcePath] = {
        resourcePath,
        description: method.description ?? '',
        httpMethod: method.httpMethod,
        params: toParams(method),
      };
    }

    services[serviceName] = { operations, helpers: {} };
  }

  return {
    // The surface is Google's now, so the version that matters is Google's, not a
    // CLI's. Recorded per service in the descriptor.
    gwsVersion: `google-discovery (${Object.entries(descriptor.services)
      .map(([n, s]) => `${n}/${s.version}`).join(', ')})`,
    services,
  };
}
