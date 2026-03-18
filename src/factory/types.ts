/**
 * Factory type system — defines the manifest schema, patch hooks,
 * and generated tool shapes for the service factory (ADR-300).
 */

import type { HandlerResponse } from '../server/formatting/markdown.js';

// --- Manifest types (declared in YAML, parsed at startup) ---

/** Parameter definition in the manifest. */
export interface ParamDef {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  max?: number;
  /** Maps this param name to a different key in the gws --params JSON. */
  maps_to?: string;
  enum?: string[];
}

/** Hydration config — fetch detail for each item in a list result. */
export interface HydrationDef {
  /** gws resource path for the detail call (e.g. "users.messages.get"). */
  resource: string;
  /** Format parameter passed to the detail call. */
  format?: string;
  /** Headers to extract from payload (gmail-specific). */
  headers?: string[];
}

/** A single operation within a service. */
export interface OperationDef {
  /** Categorizes the operation for default formatting. */
  type: 'list' | 'detail' | 'action';
  description: string;
  /** gws resource path (e.g. "users.messages.list"). */
  resource?: string;
  /** gws helper shorthand (e.g. "+triage", "+send"). */
  helper?: string;
  /** Named parameters the caller can provide. */
  params?: Record<string, ParamDef>;
  /** Default values merged into the gws --params JSON. */
  defaults?: Record<string, unknown>;
  /** Post-fetch hydration (list operations only). */
  hydration?: HydrationDef;
  /** Fields to extract from the gws response for the result. */
  fields?: string;
  /** CLI-style args instead of --params JSON (for helpers). */
  cli_args?: Record<string, string>;
}

/** A service declaration in the manifest. */
export interface ServiceDef {
  tool_name: string;
  description: string;
  /** Whether this service requires an email account param. */
  requires_email: boolean;
  /** The gws service name (e.g. "gmail", "calendar", "drive"). */
  gws_service: string;
  operations: Record<string, OperationDef>;
}

/** Top-level manifest shape. */
export interface Manifest {
  services: Record<string, ServiceDef>;
}

// --- Patch types (per-service customization hooks) ---

/** Context passed to patch hooks. */
export interface PatchContext {
  operation: string;
  params: Record<string, unknown>;
  account: string;
}

/** A patch hook that runs after arg construction, before gws execution. */
export type BeforeExecuteHook = (
  args: string[],
  ctx: PatchContext,
) => Promise<string[]> | string[];

/** A patch hook that runs after gws returns, before formatting. */
export type AfterExecuteHook = (
  result: unknown,
  ctx: PatchContext,
) => Promise<unknown> | unknown;

/** A formatter override for a specific operation type. */
export type FormatHook = (data: unknown, ctx: PatchContext) => HandlerResponse;

/** A next-steps override. */
export type NextStepsHook = (
  operation: string,
  context: Record<string, string>,
) => string;

/** Custom handler that completely replaces the factory for an operation. */
export type CustomHandler = (
  params: Record<string, unknown>,
  account: string,
) => Promise<HandlerResponse>;

/** Per-service patch — all hooks are optional. */
export interface ServicePatch {
  /** Hooks keyed by operation name. */
  beforeExecute?: Record<string, BeforeExecuteHook>;
  afterExecute?: Record<string, AfterExecuteHook>;
  /** Override formatting for list/detail/action response types. */
  formatList?: FormatHook;
  formatDetail?: FormatHook;
  formatAction?: FormatHook;
  /** Override next-steps generation. */
  nextSteps?: NextStepsHook;
  /** Completely custom handlers for operations that don't fit the factory pattern. */
  customHandlers?: Record<string, CustomHandler>;
}

// --- Generated output types ---

/** The tool schema exposed to MCP clients. */
export interface GeneratedToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A generated handler function. */
export type GeneratedHandler = (
  params: Record<string, unknown>,
) => Promise<HandlerResponse>;

/** Complete generated tool — schema + handler, ready to register. */
export interface GeneratedTool {
  schema: GeneratedToolSchema;
  handler: GeneratedHandler;
}
