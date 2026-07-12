/**
 * Errors from Google.
 *
 * Built from Google's actual error JSON, which carries a status, a reason and a
 * message written for an API caller rather than for a terminal. Do not reconstruct
 * errors by parsing text meant for humans.
 *
 * ADR-103, verification item 7.
 */

/** Google's error envelope: `{ error: { code, message, status, errors: [{ reason }] } }`. */
export interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; domain?: string; message?: string }>;
  };
}

export class GoogleApiError extends Error {
  readonly name = 'GoogleApiError';

  constructor(
    readonly status: number,
    readonly body: GoogleErrorBody,
    readonly request: { url: string; method: string },
  ) {
    super(body.error?.message ?? `HTTP ${status}`);
  }

  /** e.g. `authError`, `insufficientPermissions`, `notFound`, `rateLimitExceeded`. */
  get reason(): string | undefined {
    return this.body.error?.errors?.[0]?.reason ?? this.body.error?.status;
  }

  /**
   * Is this the "you need to re-authenticate" case?
   *
   * Read it from Google, not from an invented status code. 401 means the token is
   * bad; a 403 whose reason is a permissions/scope failure means the token is valid
   * but does not carry the scope this call needs. Both are fixed by re-consenting.
   */
  get isAuthError(): boolean {
    if (this.status === 401) return true;
    if (this.status !== 403) return false;
    const reason = this.reason ?? '';
    return reason === 'insufficientPermissions'
      || reason === 'forbidden'
      || reason === 'PERMISSION_DENIED'
      || /insufficient (authentication )?scopes?/i.test(this.message);
  }
}
