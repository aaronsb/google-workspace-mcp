/**
 * Safety policies — interceptors for destructive or sensitive operations.
 *
 * These run as beforeExecute hooks in the factory pipeline, before any
 * service-specific patches. They provide a cross-service safety layer
 * that can:
 *
 * - Block operations entirely (throw)
 * - Downgrade operations (send → draft)
 * - Require confirmation context (params that prove intent)
 * - Log/audit destructive actions
 *
 * Policies are composable — multiple can apply to the same operation.
 * They're configured per-deployment, not per-service.
 *
 * Example use cases:
 * - "Draft-only mode" — agents can read email but not send
 * - "No-delete mode" — prevent permanent deletion across all services
 * - "Audit mode" — log all write operations to stderr
 */

import type { PatchContext } from './types.js';

/** Policy decision: what to do with an intercepted operation. */
export type PolicyAction = 'allow' | 'block' | 'downgrade';

/** Result of a policy check. */
export interface PolicyResult {
  action: PolicyAction;
  reason?: string;
  /** For 'downgrade': replacement args to use instead. */
  replacementArgs?: string[];
}

/** A safety policy that evaluates an operation before execution. */
export interface SafetyPolicy {
  name: string;
  description: string;
  /** Which service.operation combinations this policy applies to. */
  applies: (service: string, operation: string) => boolean;
  /** Evaluate the operation and return a policy decision. */
  evaluate: (args: string[], ctx: PatchContext, service: string) => PolicyResult;
}

// ── Built-in policies ────────────────────────────────────────────────

/**
 * Draft-only email policy — blocks send/reply/forward, allows everything else.
 * Agents can read, search, triage, and label emails but cannot send on behalf of the user.
 */
export const draftOnlyEmail: SafetyPolicy = {
  name: 'draft-only-email',
  description: 'Block outbound email — agents can read but not send',
  applies: (service) => service === 'gmail',
  evaluate: (_args, ctx) => {
    const blocked = ['send', 'reply', 'replyAll', 'forward'];
    if (blocked.includes(ctx.operation)) {
      return {
        action: 'block',
        reason: `Operation '${ctx.operation}' is blocked by draft-only email policy. ` +
          `The agent can read, search, and triage emails but cannot send on behalf of the user.`,
      };
    }
    return { action: 'allow' };
  },
};

/**
 * No-delete policy — blocks permanent deletion across all services.
 * Trash is allowed (reversible), but delete is blocked (permanent).
 */
export const noDelete: SafetyPolicy = {
  name: 'no-delete',
  description: 'Block permanent deletion — trash is allowed, delete is not',
  applies: () => true,
  evaluate: (_args, ctx, service) => {
    // Drive delete is permanent (no trash via this operation)
    // Task/tasklist delete is permanent
    // Calendar delete is permanent
    const permanentDeletes: Record<string, string[]> = {
      gmail: [],          // 'trash' is reversible, which is fine
      calendar: ['delete'],
      drive: ['delete'],
      tasks: ['delete', 'deleteTaskList'],
      docs: [],
      sheets: [],
    };

    const blocked = permanentDeletes[service] ?? [];
    if (blocked.includes(ctx.operation)) {
      return {
        action: 'block',
        reason: `Operation '${ctx.operation}' on ${service} is blocked by no-delete policy. ` +
          `This operation permanently destroys data. Use trash/archive instead where available.`,
      };
    }
    return { action: 'allow' };
  },
};

/**
 * Classify an operation as read-only by name pattern.
 * Uses prefix/name matching so new operations are automatically classified
 * without maintaining a hardcoded list.
 */
function isReadOperation(operation: string): boolean {
  const op = operation.toLowerCase();
  // Prefix patterns: get*, list*, search*
  if (op.startsWith('get') || op.startsWith('list') || op.startsWith('search')) return true;
  // Exact read-only names
  const readOps = ['read', 'triage', 'labels', 'threads', 'agenda', 'calendars', 'freebusy'];
  return readOps.includes(op);
}

/**
 * Read-only policy — blocks all write operations across all services.
 * Only list, get, search, and read operations are allowed.
 */
export const readOnly: SafetyPolicy = {
  name: 'read-only',
  description: 'Block all write operations — observation only',
  applies: () => true,
  evaluate: (_args, ctx) => {
    if (!isReadOperation(ctx.operation)) {
      return {
        action: 'block',
        reason: `Operation '${ctx.operation}' is blocked by read-only policy. ` +
          `Only search, list, read, and get operations are allowed.`,
      };
    }
    return { action: 'allow' };
  },
};

/**
 * Audit policy — allows everything but logs destructive operations to stderr.
 * Useful for monitoring what an agent does without blocking it.
 */
export const auditLog: SafetyPolicy = {
  name: 'audit-log',
  description: 'Log all write operations to stderr — no blocking',
  applies: () => true,
  evaluate: (_args, ctx, service) => {
    if (!isReadOperation(ctx.operation)) {
      process.stderr.write(
        `[gws-mcp] AUDIT: ${service}.${ctx.operation} account=${ctx.account} ` +
        `args=${JSON.stringify(ctx.params)}\n`,
      );
    }
    return { action: 'allow' };
  },
};

// ── Policy engine ────────────────────────────────────────────────────

/** Active policies — configured at startup. */
let activePolicies: SafetyPolicy[] = [];

/** Set the active safety policies. */
export function configurePolicies(policies: SafetyPolicy[]): void {
  activePolicies = policies;
  if (policies.length > 0) {
    process.stderr.write(
      `[gws-mcp] safety: ${policies.length} policy(ies) active: ` +
      `${policies.map(p => p.name).join(', ')}\n`,
    );
  }
}

/** Get the active policies (defensive copy). */
export function getActivePolicies(): SafetyPolicy[] {
  return [...activePolicies];
}

/**
 * Run all active policies against an operation.
 * First block wins. Returns the most restrictive result.
 */
export function evaluatePolicies(
  args: string[],
  ctx: PatchContext,
  service: string,
): PolicyResult {
  for (const policy of activePolicies) {
    if (!policy.applies(service, ctx.operation)) continue;

    const result = policy.evaluate(args, ctx, service);
    if (result.action === 'block') {
      process.stderr.write(
        `[gws-mcp] safety: BLOCKED ${service}.${ctx.operation} by ${policy.name}: ${result.reason}\n`,
      );
      return result;
    }
    if (result.action === 'downgrade' && result.replacementArgs) {
      process.stderr.write(
        `[gws-mcp] safety: DOWNGRADED ${service}.${ctx.operation} by ${policy.name}: ${result.reason}\n`,
      );
      return result;
    }
  }
  return { action: 'allow' };
}
