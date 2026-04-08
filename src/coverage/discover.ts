/**
 * gws CLI surface discovery — enumerates services, resources, methods,
 * helpers, and parameter schemas by invoking the gws binary.
 */

import { execFileSync } from 'node:child_process';
import { resolveGwsBinary } from '../executor/gws.js';
import {
  ELIGIBLE_SERVICES, SKIP_PARAMS,
  type DiscoveredSurface, type DiscoveredService,
  type DiscoveredOperation, type DiscoveredHelper, type DiscoveredParam,
} from './types.js';

const TIMEOUT = 10_000;

function gws(args: string[]): string {
  const binary = resolveGwsBinary();
  return execFileSync(binary, args, {
    encoding: 'utf8',
    timeout: TIMEOUT,
    env: { ...process.env },
  });
}

function gwsSafe(args: string[]): string | null {
  try {
    const binary = resolveGwsBinary();
    return execFileSync(binary, args, {
      encoding: 'utf8',
      timeout: TIMEOUT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** Parse service --help to find resources and helpers. */
function parseServiceHelp(output: string): { resources: string[]; helpers: DiscoveredHelper[] } {
  const resources: string[] = [];
  const helpers: DiscoveredHelper[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trimStart();

    // Helpers: lines starting with +
    const helperMatch = trimmed.match(/^(\+\w+)\s+(?:\[Helper\]\s*)?(.*)$/);
    if (helperMatch) {
      helpers.push({ name: helperMatch[1], description: helperMatch[2].trim() });
      continue;
    }

    // Resources: "word  Operations on the '...' resource"
    const resourceMatch = trimmed.match(/^(\w+)\s+Operations on the/);
    if (resourceMatch && resourceMatch[1] !== 'help') {
      resources.push(resourceMatch[1]);
    }
  }

  return { resources, helpers };
}

/** Parse resource --help to find methods and sub-resources. */
function parseResourceHelp(output: string): { methods: string[]; subResources: string[] } {
  const methods: string[] = [];
  const subResources: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('Usage:') || trimmed.startsWith('FLAGS:')) continue;

    const resourceMatch = trimmed.match(/^(\w+)\s+Operations on the/);
    if (resourceMatch && resourceMatch[1] !== 'help') {
      subResources.push(resourceMatch[1]);
      continue;
    }

    // Methods: "word  Description text" (not "help", not "Operations on")
    const methodMatch = trimmed.match(/^(\w+)\s+\S/);
    if (methodMatch && methodMatch[1] !== 'help' && !trimmed.includes('Operations on')) {
      methods.push(methodMatch[1]);
    }
  }

  return { methods, subResources };
}

/** Parse gws schema JSON output into DiscoveredParam records. */
function parseSchemaParams(json: string): Record<string, DiscoveredParam> {
  const params: Record<string, DiscoveredParam> = {};
  try {
    const schema = JSON.parse(json);
    const rawParams = schema.parameters || {};
    for (const [name, def] of Object.entries(rawParams)) {
      if (SKIP_PARAMS.has(name)) continue;
      const p = def as Record<string, unknown>;
      params[name] = {
        type: String(p.type === 'integer' ? 'number' : (p.type || 'string')),
        description: String(p.description || '').replace(/\n/g, ' ').slice(0, 200),
        required: Boolean(p.required),
        ...(p.default !== undefined ? { default: p.default } : {}),
        ...(p.enum ? { enum: p.enum as string[] } : {}),
        ...(p.deprecated ? { deprecated: true } : {}),
      };
    }
  } catch {
    // Schema parse failed — return empty params
  }
  return params;
}

/** Recursively discover methods under a resource path. */
function discoverResource(
  service: string,
  parentPath: string,
  parts: string[],
): Record<string, DiscoveredOperation> {
  const operations: Record<string, DiscoveredOperation> = {};

  const helpOutput = gwsSafe([service, ...parts, '--help']);
  if (!helpOutput) return operations;

  const { methods, subResources } = parseResourceHelp(helpOutput);

  for (const method of methods) {
    const resourcePath = `${parentPath}.${method}`;
    const schemaOutput = gwsSafe(['schema', `${service}.${parentPath}.${method}`]);

    let params: Record<string, DiscoveredParam> = {};
    let description = '';
    let httpMethod: string | undefined;

    if (schemaOutput) {
      params = parseSchemaParams(schemaOutput);
      try {
        const schema = JSON.parse(schemaOutput);
        description = String(schema.description || '').replace(/\n/g, ' ').slice(0, 200);
        httpMethod = schema.httpMethod;
      } catch { /* ignore */ }
    }

    operations[resourcePath] = { resourcePath, description, httpMethod, params };
  }

  for (const sub of subResources) {
    const subOps = discoverResource(service, `${parentPath}.${sub}`, [...parts, sub]);
    Object.assign(operations, subOps);
  }

  return operations;
}

/** Discover the full surface of a single gws service. */
function discoverService(service: string): DiscoveredService {
  const helpOutput = gwsSafe([service, '--help']);
  if (!helpOutput) return { operations: {}, helpers: {} };

  const { resources, helpers } = parseServiceHelp(helpOutput);
  const helperMap: Record<string, DiscoveredHelper> = {};
  for (const h of helpers) {
    helperMap[h.name] = h;
  }

  let operations: Record<string, DiscoveredOperation> = {};
  for (const resource of resources) {
    const resourceOps = discoverResource(service, resource, [resource]);
    operations = { ...operations, ...resourceOps };
  }

  return { operations, helpers: helperMap };
}

/** Discover the full gws CLI surface for all eligible services. */
export function discoverSurface(): DiscoveredSurface {
  // Get gws version
  let gwsVersion = 'unknown';
  try {
    gwsVersion = gws(['--version']).trim().split('\n')[0];
  } catch { /* ignore */ }

  const services: Record<string, DiscoveredService> = {};

  for (const service of ELIGIBLE_SERVICES) {
    process.stderr.write(`[coverage] discovering ${service}...\n`);
    services[service] = discoverService(service);
  }

  return { gwsVersion, services };
}
