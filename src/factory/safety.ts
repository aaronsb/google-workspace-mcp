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
 *
 * Most are configured per-deployment via GWS_SAFETY_POLICY:
 * - "Draft-only mode" — agents can read email but not send
 * - "No-delete mode" — prevent permanent deletion across all services
 * - "Audit mode" — log all write operations to stderr
 *
 * `account-access` is the exception and is always active. It enforces a per-ACCOUNT
 * choice the user made at consent time rather than a deployment-wide one, and it blocks
 * by returning a reason rather than throwing. See ADR-202.
 *
 * WHO RUNS THIS: `generateHandler` calls it for every factory-generated operation, and
 * `manage_scratchpad` calls it explicitly for its send and sync writes (#171) because it
 * is hand-registered and gets no policy check for free. Any future hand-registered tool
 * that writes to Google has to do the same — nothing enforces that from here, which is
 * exactly how scratchpad went uncovered.
 *
 * `manage_accounts` and `manage_workspace` are also hand-registered and need no check:
 * neither writes through a Google API.
 */

import { readCredential } from '../accounts/credentials.js';
import { anyScopesFor, writeScopesFor } from '../accounts/oauth.js';
import { loadDescriptor } from '../google/descriptor.js';
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

/**
 * What the manifest knows about the operation being evaluated.
 *
 * `service` and `googleService` differ for exactly one service and that difference
 * matters: contacts is declared in `contacts.yaml` but calls `people`. Scope maps are
 * keyed by the manifest name, the descriptor by the Google name, so a policy consulting
 * both needs both.
 */
export interface OperationInfo {
  /** Manifest service name — the key in SERVICE_SCOPE_MAP (e.g. 'contacts'). */
  service: string;
  /** Google API service — the key in descriptor.json (e.g. 'people'). */
  googleService: string;
  /** Google method path (e.g. 'people.createContact'). Absent on pure custom handlers. */
  resource?: string;
  /** The manifest's declared intent. */
  type: 'list' | 'detail' | 'action';
}

/** A safety policy that evaluates an operation before execution. */
export interface SafetyPolicy {
  name: string;
  description: string;
  /** Which service.operation combinations this policy applies to. */
  applies: (service: string, operation: string) => boolean;
  /**
   * Evaluate the operation and return a policy decision.
   *
   * May be async: `account-access` reads the caller's credential file. Policies that
   * need neither `op` nor async can keep ignoring both — a narrower implementation
   * still satisfies this type.
   */
  evaluate: (
    args: string[],
    ctx: PatchContext,
    service: string,
    op?: OperationInfo,
  ) => PolicyResult | Promise<PolicyResult>;
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
      // Keyed by google_service, so contacts is `people`. An operator who turned this
      // policy on asked for no permanent deletion; whether Google's own trash would have
      // caught the contact is not the question they asked.
      people: ['delete'],
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
  const readOps = ['read', 'triage', 'labels', 'threads', 'agenda', 'calendars', 'freebusy', 'tree'];
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
 * Access policy — refuse a write from an account that was authorized read-only, and say
 * so in a sentence, before the request leaves. ADR-202.
 *
 * This is the enforcement half of per-account access. The consent half narrows the token;
 * this half explains what happened when the narrowed token is asked to do more. Without
 * it Google still refuses — with a 403 that names neither the account, nor the scope, nor
 * the way out.
 *
 * UNLIKE EVERY OTHER POLICY HERE, this one is always on. The others express a deployment
 * choice an operator opts into with GWS_SAFETY_POLICY. This one enforces a choice the
 * *user* already made at consent time, so requiring a second opt-in to honour it would
 * make the first one decorative.
 *
 * It fails OPEN in every case where it cannot be sure: an account with no credential, an
 * unreadable credential file, a service with no scope map, an unknown method. A safety
 * check that blocks on its own uncertainty stops being a safety check and becomes an
 * outage — and the operations at issue are ones Google will independently refuse anyway.
 */
export const accountAccess: SafetyPolicy = {
  name: 'account-access',
  description: 'Refuse writes from a read-only account, naming the account and the fix',
  applies: () => true,
  evaluate: async (_args, ctx, _service, op) => {
    // No account (a service that needs none) or no manifest info: nothing to check against.
    if (!ctx.account || !op) return { action: 'allow' };

    let granted: Set<string>;
    try {
      const cred = await readCredential(ctx.account);
      granted = new Set(cred.scopes ?? []);
    } catch (err) {
      // Not authenticated, or the credential is unreadable. The auth path already has a
      // good error for that; inventing a second one here would only obscure it.
      //
      // Say so on stderr regardless. Blocks are logged; a silent allow is not, so a
      // truncated credential file would otherwise disable enforcement for that account
      // with no signal anywhere — the failure mode you least want to be quiet.
      process.stderr.write(
        `[google-workspace-mcp] safety: account-access NOT enforcing for ${ctx.account} — ` +
        `could not read its credential (${err instanceof Error ? err.message : String(err)})\n`,
      );
      return { action: 'allow' };
    }
    if (granted.size === 0) return { action: 'allow' };

    const required = await requiredScopes(op);
    if (required.length === 0) return { action: 'allow' };
    if (required.some((scope) => granted.has(scope))) return { action: 'allow' };

    // Nothing the operation accepts was granted. Two different causes, two different fixes.
    const holdsSomething = anyScopesFor(op.service).some((scope) => granted.has(scope));
    const reconsent =
      `manage_accounts {operation:'scopes', email:'${ctx.account}', ` +
      `services:'${op.service}', access:'readwrite'}`;

    return {
      action: 'block',
      reason: holdsSomething
        ? `'${ctx.operation}' needs write access to ${op.service}. ` +
          `Account ${ctx.account} was authorized read-only for ${op.service}. ` +
          `Re-authorize with ${reconsent}, or use an account that already has it.`
        : `'${ctx.operation}' needs access to ${op.service}, which account ${ctx.account} ` +
          `has never authorized. Grant it with ${reconsent}, or use an account that already has it.`,
    };
  },
};

/**
 * The scopes Google will accept for this operation.
 *
 * Prefers the descriptor, which is Google's own per-method scope list (ADR-103) and so
 * cannot drift from what Google actually enforces. A hand-kept table of write operations
 * would be a second source of truth — the #161 failure.
 *
 * Seven of 95 operations declare no `resource` because they are pure custom handlers that
 * make several calls (`gmail.send`, `drive.upload`, `calendar.create` and friends), and
 * six of those seven are writes. Leaving them unenforced would exempt exactly the
 * operations most worth enforcing, so they fall back to the manifest's declared `type`,
 * which a test already pins against the descriptor's httpMethod.
 */
async function requiredScopes(op: OperationInfo): Promise<string[]> {
  if (op.resource) {
    const descriptor = await loadDescriptor();
    const method = descriptor.services[op.googleService]?.methods?.[op.resource];
    // An unknown method means the manifest and the descriptor disagree. That is a bug
    // worth failing on, but not here, at the cost of the user's request.
    if (method?.scopes?.length) return method.scopes;
    return [];
  }
  return op.type === 'action' ? writeScopesFor(op.service) : anyScopesFor(op.service);
}

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
        `[google-workspace-mcp] AUDIT: ${service}.${ctx.operation} account=${ctx.account} ` +
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
      `[google-workspace-mcp] safety: ${policies.length} policy(ies) active: ` +
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
export async function evaluatePolicies(
  args: string[],
  ctx: PatchContext,
  service: string,
  op?: OperationInfo,
): Promise<PolicyResult> {
  for (const policy of activePolicies) {
    if (!policy.applies(service, ctx.operation)) continue;

    const result = await policy.evaluate(args, ctx, service, op);
    if (result.action === 'block') {
      process.stderr.write(
        `[google-workspace-mcp] safety: BLOCKED ${service}.${ctx.operation} by ${policy.name}: ${result.reason}\n`,
      );
      return result;
    }
    if (result.action === 'downgrade' && result.replacementArgs) {
      process.stderr.write(
        `[google-workspace-mcp] safety: DOWNGRADED ${service}.${ctx.operation} by ${policy.name}: ${result.reason}\n`,
      );
      return result;
    }
  }
  return { action: 'allow' };
}
