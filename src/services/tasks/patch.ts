/**
 * Tasks patch.
 *
 * Google Tasks answers a PATCH carrying an empty body with
 *
 *     500  "Internal error encountered."  (reason: backendError)
 *
 * which reads like a Google outage and is nothing of the sort — it is us sending a
 * request with nothing in it. `update` used to declare no updatable fields at all, so
 * an empty body was the ONLY request it could construct, and every single call to it
 * failed this way, blaming Google.
 *
 * The manifest now carries title / notes / due / status. But a caller who passes only
 * the two ids still builds an empty patch, so refuse it here — with a message that says
 * what to do — rather than hand back a 500 that points at the wrong culprit.
 */

import type { ServicePatch } from '../../factory/types.js';

/**
 * The Task fields `update` can actually change — the body of the PATCH.
 *
 * These are named as GOOGLE names them, not as the manifest does. beforeExecute runs
 * AFTER buildResourceParams has applied `maps_to`, so by this point `taskListId` is
 * already `tasklist` and `taskId` is `task`. The ids need no checking here anyway —
 * the manifest marks them required, so the tool schema rejects a call without them.
 */
const MUTABLE = ['title', 'notes', 'due', 'status'] as const;

export const tasksPatch: ServicePatch = {
  beforeExecute: {
    update: (params) => {
      const given = MUTABLE.filter((f) => params[f] !== undefined && params[f] !== '');
      if (given.length === 0) {
        throw new Error(
          'Nothing to update — pass at least one of: title, notes, due, status.',
        );
      }
      return params;
    },
  },
};
