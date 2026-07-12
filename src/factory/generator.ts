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
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from '../factory/yaml.js';
import { call as googleCall } from '../google/client.js';
import type { GoogleService, ServiceMethods } from '../google/methods.js';
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
 * This module's own directory, used to resolve the manifest relative to the
 * built output — which is what makes `npx` and the .mcpb bundle work, where cwd
 * is not the project root.
 *
 * This used to be injected by registry.ts via a `setModuleDir()` setter, purely
 * because the CJS Jest runner could not parse `import.meta`. The test runner was
 * shaping the source. Vitest runs ESM natively (ADR-101), so the module can just
 * ask where it is.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

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
 * Locate the manifest directory: always a sibling of this module.
 *
 * This resolves to `src/factory/manifest` when running the sources (vitest, tsx)
 * and `build/factory/manifest` in the built server — which is what makes `npx`
 * and the .mcpb bundle work, where cwd is not the project root.
 *
 * There is deliberately NO fallback chain. An earlier version tried three more
 * candidates (back to `src/` from `build/`, then two cwd-relative paths), which
 * sounds like resilience and is actually concealment: the only time a fallback
 * fires is when the built manifest is missing, and the `src/` fallback exists
 * *only in the dev checkout*. A build shipped without its manifest therefore
 * resolved fine on this machine and in CI, and threw on the consumer's first
 * `npx` start. Failing here, immediately and everywhere, is the point.
 */
function resolveManifestDir(): string {
  const dir = resolve(MODULE_DIR, 'manifest');
  try {
    readdirSync(dir);
  } catch {
    throw new Error(
      `Could not read the manifest directory at ${dir}. ` +
      `In a built server this directory is copied from src/factory/manifest by ` +
      `the build; if it is missing, the build did not complete. Run \`npm run build\`.`,
    );
  }
  return dir;
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
  const domain = domainMap[service.tool_name] ?? service.google_service;

  return async (params: Record<string, unknown>): Promise<HandlerResponse> => {
    const operation = params.operation as string;
    const opDef = service.operations[operation];
    if (!opDef) {
      throw new Error(`Unknown ${service.google_service} operation: ${operation}`);
    }

    const account = service.requires_email ? requireEmail(params) : '';
    const ctx: PatchContext = { operation, params, account };

    // Safety policies — run before anything else, including custom handlers.
    // A blocked operation never reaches the handler or gws.
    const policyResult = evaluatePolicies([], ctx, service.google_service);
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

    // THE SEAM (ADR-103). Resource operations go to the Google API client we own,
    // driven by the generated descriptor. Helper operations still shell out to the
    // gws facade — they are gws INVENTIONS with no Google method behind them, and
    // they are dismantled next. This is deliberately a staged migration: the 70
    // resource ops move together, and nothing else changes underneath them.
    //
    // Safe to do in one step because item 2 measured it: for the 26 resource ops
    // diffed live, gws and the client returned BYTE-IDENTICAL JSON. The formatters
    // below are reading exactly what they read before.
    let data: unknown;

    if (opDef.resource) {
      let callParams = buildResourceParams(opDef, params);

      // beforeExecute now takes PARAMS, not gws argv. The old hooks did JSON
      // surgery on an argv slot — `JSON.parse(args[args.indexOf('--params') + 1])`
      // — purely because the seam was a command line. That is gone.
      if (patch?.beforeExecute?.[operation]) {
        callParams = await patch.beforeExecute[operation](callParams, ctx);
      }

      // The one place a cast is honest. Here the service and the resource path come
      // from the MANIFEST — YAML, read at runtime — so no compile-time type can
      // check them. That is fine, because this path has its own guard at a
      // different stage:
      //
      //   hand-written call sites  -> COMPILE time  (ServiceMethods[S]; see src/google/methods.ts)
      //   manifest-driven ops      -> BUILD time    (check-conformance: manifest ⊆ descriptor)
      //
      // Between them, every route to Google is checked before it can reach a user.
      // The conformance check is probed and goes red on a bogus resource path, so
      // a typo in the YAML fails the build rather than the call.
      data = await googleCall(
        service.google_service as GoogleService,
        opDef.resource as ServiceMethods[GoogleService],
        callParams,
        { account },
      );
    } else {
      // No resource, and no custom handler took it. There is nothing left to call.
      //
      // This branch USED to shell out to a gws `+helper`. Every one of those is
      // gone: nine of them were plain Google methods wearing a CLI costume, and
      // the two that genuinely reshaped anything (+triage, +agenda) are now built
      // from raw Google in our own layer. See ADR-103.
      throw new Error(
        `${service.google_service}.${operation} declares no 'resource' and has no custom handler.`,
      );
    }

    // afterExecute hook — takes DATA, and is unaffected by the seam change.
    // This is the hook that already turns raw Google into OUR shape (see
    // gmailPatch.afterExecute.search, which walks payload.headers). It is the
    // right place for interpretation, and it is where the helpers' opinions go.
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

// `buildArgs()` is gone. Resource operations no longer become a command line at
// all — they become params for the client (see buildResourceParams above). Only
// helper operations still build argv, and only until they are dismantled: they are
// gws INVENTIONS with no Google method behind them. See ADR-103.

/**
 * Build the params a resource operation sends to Google.
 *
 * This is the manifest's mapping — declared params, `maps_to` renames, defaults,
 * clamps — and it is unchanged by the move off gws. It used to be serialised into
 * a `--params` JSON argv slot; now it is simply the request params. The mapping
 * was never gws-specific, which is why the migration is mechanical.
 */
export function buildResourceParams(
  opDef: OperationDef,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...opDef.defaults };

  if (opDef.params) {
    for (const [paramName, paramDef] of Object.entries(opDef.params)) {
      if (paramDef.client_only) continue; // formatter-only; never reaches Google
      const value = params[paramName];
      const targetKey = paramDef.maps_to ?? paramName;

      if (value !== undefined && value !== null) {
        out[targetKey] = paramDef.max
          ? clamp(value, paramDef.default as number ?? 10, paramDef.max)
          : value;
      } else if (paramDef.default !== undefined) {
        out[targetKey] = paramDef.default;
      }
    }
  }

  for (const [key, val] of Object.entries(out)) {
    if (val === undefined) delete out[key];
  }
  return out;
}

