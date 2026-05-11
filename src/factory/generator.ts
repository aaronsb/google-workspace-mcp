/**
 * Factory generator — reads the manifest and produces MCP tools.
 *
 * For each service in the manifest, generates:
 * 1. A JSON Schema tool definition (operation enum, typed params)
 * 2. A handler function (maps operations to gws CLI calls, applies formatting)
 *
 * Patches are optional per-service hooks that override default behavior.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parse as parseYaml } from '../factory/yaml.js';
import { execute } from '../executor/gws.js';
import { requireEmail, clamp } from '../server/handlers/validate.js';
import { formatDefault } from './defaults.js';
import { nextSteps } from '../server/formatting/next-steps.js';
import { evaluatePolicies } from './safety.js';
import type {
  Manifest,
  ServiceDef,
  OperationDef,
  ServicePatch,
  PatchContext,
  GeneratedTool,
  GeneratedToolSchema,
  GeneratedHandler,
} from './types.js';
import type { HandlerResponse } from '../server/formatting/markdown.js';

/**
 * Module directory for manifest resolution.
 * Set by registry.ts via setModuleDir() using import.meta.url (ESM only).
 * Null in Jest (CJS) — falls back to cwd-based resolution.
 */
let _moduleDir: string | undefined;

/** Called by registry.ts to inject the ESM module directory. */
export function setModuleDir(dir: string): void {
  _moduleDir = dir;
}

/**
 * Load the manifest from `src/factory/manifest/` — one YAML file per service,
 * each file's root being that service's definition; the filename (minus
 * `.yaml`) is the service key (ADR-304). Assembles a `Manifest` with the same
 * shape the old single-file `manifest.yaml` produced.
 *
 * A malformed file fails the whole load (parseYaml throws) — same whole-or-
 * nothing behavior as before the split.
 *
 * @param dir Optional explicit manifest directory (used by tests/tools);
 *   otherwise resolved relative to the built output, then cwd.
 */
export function loadManifest(dir?: string): Manifest {
  const manifestDir = dir ?? resolveManifestDir();
  const files = readdirSync(manifestDir).filter((f) => f.endsWith('.yaml')).sort();
  if (files.length === 0) {
    throw new Error(`No manifest files (*.yaml) found in ${manifestDir}`);
  }

  const services: Record<string, ServiceDef> = {};
  for (const file of files) {
    const name = basename(file, '.yaml');
    services[name] = parseYaml(readFileSync(resolve(manifestDir, file), 'utf-8')) as ServiceDef;
  }
  return { services };
}

/**
 * Locate the manifest directory. moduleDir is injected by registry.ts using
 * import.meta.url (ESM only); cwd fallbacks handle Jest/dev where cwd is the
 * project root.
 */
function resolveManifestDir(): string {
  const candidates: string[] = [];

  if (_moduleDir) {
    candidates.push(resolve(_moduleDir, 'manifest'));                     // build/factory/manifest/
    candidates.push(resolve(_moduleDir, '../../src/factory/manifest'));   // dev: from build/ to src/
  }

  candidates.push(resolve(process.cwd(), 'src/factory/manifest'));
  candidates.push(resolve(process.cwd(), 'build/factory/manifest'));

  for (const candidate of candidates) {
    try {
      if (readdirSync(candidate).some((f) => f.endsWith('.yaml'))) return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    `Could not find the manifest directory. Searched:\n${candidates.join('\n')}`,
  );
}

/** Generate all tools from the manifest with optional patches. */
export function generateTools(
  manifest: Manifest,
  patches?: Record<string, ServicePatch>,
): GeneratedTool[] {
  const tools: GeneratedTool[] = [];

  for (const [serviceName, serviceDef] of Object.entries(manifest.services)) {
    const patch = patches?.[serviceName];
    const schema = generateSchema(serviceDef);
    const handler = generateHandler(serviceDef, patch);
    tools.push({ schema, handler });
  }

  return tools;
}

/** Generate the JSON Schema tool definition from a service declaration. */
export function generateSchema(service: ServiceDef): GeneratedToolSchema {
  const operationNames = Object.keys(service.operations);
  const operationDescriptions = operationNames
    .map(name => `${name}: ${service.operations[name].description}`)
    .join(' | ');

  // Collect all unique params across operations
  const allParams: Record<string, { type: string; description: string; enum?: string[] }> = {};
  for (const op of Object.values(service.operations)) {
    if (!op.params) continue;
    for (const [paramName, paramDef] of Object.entries(op.params)) {
      if (!allParams[paramName]) {
        allParams[paramName] = {
          type: paramDef.type,
          description: paramDef.description,
          ...(paramDef.enum ? { enum: paramDef.enum } : {}),
        };
      }
    }
  }

  const properties: Record<string, unknown> = {
    operation: {
      type: 'string',
      enum: operationNames,
      description: operationDescriptions,
    },
  };

  if (service.requires_email) {
    properties.email = { type: 'string', description: 'Account email address' };
  }

  for (const [name, def] of Object.entries(allParams)) {
    properties[name] = { type: def.type, description: def.description, ...(def.enum ? { enum: def.enum } : {}) };
  }

  const required = service.requires_email ? ['operation', 'email'] : ['operation'];

  return {
    name: service.tool_name,
    description: service.description,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

/** Generate a handler function for a service. */
export function generateHandler(
  service: ServiceDef,
  patch?: ServicePatch,
): GeneratedHandler {
  // Map tool_name to the next-steps domain key
  const domainMap: Record<string, string> = {
    manage_email: 'email',
    manage_calendar: 'calendar',
    manage_drive: 'drive',
  };
  const domain = domainMap[service.tool_name] ?? service.gws_service;

  return async (params: Record<string, unknown>): Promise<HandlerResponse> => {
    const operation = params.operation as string;
    const opDef = service.operations[operation];
    if (!opDef) {
      throw new Error(`Unknown ${service.gws_service} operation: ${operation}`);
    }

    const account = service.requires_email ? requireEmail(params) : '';
    const ctx: PatchContext = { operation, params, account };

    // Safety policies — run before anything else, including custom handlers.
    // A blocked operation never reaches the handler or gws.
    const policyResult = evaluatePolicies([], ctx, service.gws_service);
    if (policyResult.action === 'block') {
      return {
        text: `**Blocked by safety policy:** ${policyResult.reason}`,
        refs: { blocked: true, policy: policyResult.reason },
      };
    }

    // Context map for next-steps placeholder resolution — built once,
    // used whether the request goes through a custom handler or the
    // factory path.
    const contextMap: Record<string, string> = { email: account };
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') contextMap[key] = value;
    }

    const framingFooter = (): string =>
      patch?.nextSteps
        ? patch.nextSteps(operation, contextMap)
        : nextSteps(domain, operation, contextMap);

    // Check for a fully custom handler first. The generator still owns
    // framing (next-steps append) — handlers produce the response text;
    // the factory frames it. See ADR-303.
    if (patch?.customHandlers?.[operation]) {
      const response = await patch.customHandlers[operation](params, account);
      return {
        ...response,
        text: response.text + framingFooter(),
      };
    }

    // Build gws args
    let args = policyResult.action === 'downgrade' && policyResult.replacementArgs
      ? policyResult.replacementArgs
      : buildArgs(service.gws_service, opDef, params);

    // beforeExecute hook (service-specific)
    if (patch?.beforeExecute?.[operation]) {
      args = await patch.beforeExecute[operation](args, ctx);
    }

    // Execute gws
    const result = await execute(args, { account, format: 'json' });

    // afterExecute hook
    let data = result.data;
    if (patch?.afterExecute?.[operation]) {
      data = await patch.afterExecute[operation](data, ctx);
    }

    let formatted: HandlerResponse;

    // Check for patch formatters by operation type
    if (opDef.type === 'list' && patch?.formatList) {
      formatted = patch.formatList(data, ctx);
    } else if (opDef.type === 'detail' && patch?.formatDetail) {
      formatted = patch.formatDetail(data, ctx);
    } else if (opDef.type === 'action' && patch?.formatAction) {
      formatted = patch.formatAction(data, ctx);
    } else {
      formatted = formatDefault(data, opDef);
    }

    return {
      ...formatted,
      text: formatted.text + framingFooter(),
    };
  };
}

/** Build gws CLI args from an operation definition and user params. */
function buildArgs(
  gwsService: string,
  opDef: OperationDef,
  params: Record<string, unknown>,
): string[] {
  // Helper-based operations use positional/flag args
  if (opDef.helper) {
    return buildHelperArgs(gwsService, opDef, params);
  }

  // Resource-based operations use --params JSON
  if (opDef.resource) {
    return buildResourceArgs(gwsService, opDef, params);
  }

  throw new Error(`Operation must define either 'resource' or 'helper'`);
}

/** Build args for gws resource calls: `gws service resource method --params '{...}'` */
function buildResourceArgs(
  gwsService: string,
  opDef: OperationDef,
  params: Record<string, unknown>,
): string[] {
  const resourceParts = opDef.resource!.split('.');
  const args = [gwsService, ...resourceParts];

  // Build the --params JSON object
  const gwsParams: Record<string, unknown> = { ...opDef.defaults };

  if (opDef.params) {
    for (const [paramName, paramDef] of Object.entries(opDef.params)) {
      if (paramDef.client_only) continue; // formatter-only; never reaches gws
      const value = params[paramName];
      const targetKey = paramDef.maps_to ?? paramName;

      if (value !== undefined && value !== null) {
        gwsParams[targetKey] = paramDef.max
          ? clamp(value, paramDef.default as number ?? 10, paramDef.max)
          : value;
      } else if (paramDef.default !== undefined) {
        gwsParams[targetKey] = paramDef.default;
      }
    }
  }

  // Clean undefined values
  for (const [key, val] of Object.entries(gwsParams)) {
    if (val === undefined) delete gwsParams[key];
  }

  if (Object.keys(gwsParams).length > 0) {
    args.push('--params', JSON.stringify(gwsParams));
  }

  return args;
}

/** Build args for gws helper calls: `gws service +helper --flag value ...` */
function buildHelperArgs(
  gwsService: string,
  opDef: OperationDef,
  params: Record<string, unknown>,
): string[] {
  const args = [gwsService, opDef.helper!];

  // Some helpers take a positional arg (e.g. +reply messageId)
  // Check for required params that aren't in cli_args — those are positional
  if (opDef.params) {
    for (const [paramName, paramDef] of Object.entries(opDef.params)) {
      if (paramDef.client_only) continue; // formatter-only; never reaches gws
      const value = params[paramName];
      if (value === undefined || value === null) continue;

      if (opDef.cli_args?.[paramName]) {
        // Flag-style arg
        args.push(opDef.cli_args[paramName], String(value));
      } else if (paramDef.required) {
        // Positional arg
        args.push(String(value));
      }
    }
  }

  return args;
}
