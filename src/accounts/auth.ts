import { readCredential, saveCredential, hasCredential } from './credentials.js';
import { credentialPath } from '../executor/paths.js';
import { runOAuthFlow, scopesForServices, ALL_SERVICES } from './oauth.js';
import type { AccessLevel } from './oauth.js';
import { getAccessToken, invalidateToken } from './token-service.js';

export interface AuthResult {
  status: 'success' | 'error';
  account?: string;
  credentialPath?: string;
  error?: string;
  errorType?: string;
  /** What the account was authorized for. */
  access?: AccessLevel;
  /**
   * Services asked for as read-only that can still write, because Google offers no
   * read-only scope for them. Non-empty means this account got more access than was
   * asked for, and the response has to say so (ADR-202).
   */
  stillAllowWrites?: string[];
}

export interface AccountStatus {
  email: string;
  tokenValid: boolean;
  scopes: string[];
  scopeCount: number;
  hasRefreshToken: boolean;
  /** Absent on credentials written before ADR-202, which are all read/write. */
  access: AccessLevel;
  /** Services that can still write despite `access: 'read'`. Empty for full access. */
  stillAllowWrites: string[];
}

/**
 * Authenticate a new account via our own OAuth2 flow.
 * Requests all service scopes by default.
 *
 * `access` defaults to 'readwrite', so an account authorized without naming it is
 * granted exactly what it would have been before ADR-202.
 */
export async function authenticateAccount(
  clientId: string,
  clientSecret: string,
  access: AccessLevel = 'readwrite',
): Promise<AuthResult> {
  const { scopes, stillAllowWrites } = scopesForServices(ALL_SERVICES, access);
  const result = await runOAuth(clientId, clientSecret, scopes, access, stillAllowWrites);
  return { ...result, access, stillAllowWrites };
}

/**
 * Re-authenticate with a specific set of services.
 * Used by the `scopes` operation as an escape hatch.
 */
export async function reauthWithServices(
  clientId: string,
  clientSecret: string,
  services: string,
  access: AccessLevel = 'readwrite',
): Promise<AuthResult> {
  const { scopes, stillAllowWrites } = scopesForServices(services, access);
  const result = await runOAuth(clientId, clientSecret, scopes, access, stillAllowWrites);
  return { ...result, access, stillAllowWrites };
}

/**
 * Check account status: token validity and granted scopes.
 * Reads scopes from the per-account credential file.
 * Validates token by attempting a refresh via the token service.
 */
export async function checkAccountStatus(email: string): Promise<AccountStatus> {
  const hasCred = await hasCredential(email);
  if (!hasCred) {
    return {
      email,
      tokenValid: false,
      scopes: [],
      scopeCount: 0,
      hasRefreshToken: false,
      access: 'readwrite',
      stillAllowWrites: [],
    };
  }

  const cred = await readCredential(email);
  const hasRefreshToken = Boolean(cred.refresh_token);
  const scopes = cred.scopes ?? [];

  let tokenValid = false;
  try {
    await getAccessToken(email);
    tokenValid = true;
  } catch {
    tokenValid = false;
  }

  return {
    email,
    tokenValid,
    scopes,
    scopeCount: scopes.length,
    hasRefreshToken,
    // Absent means read/write — see AuthorizedUserCredential.access.
    access: cred.access ?? 'readwrite',
    stillAllowWrites: cred.stillAllowWrites ?? [],
  };
}

// --- Internal ---

async function runOAuth(
  clientId: string,
  clientSecret: string,
  scopes: string[],
  access: AccessLevel = 'readwrite',
  stillAllowWrites: string[] = [],
): Promise<AuthResult> {
  try {
    const result = await runOAuthFlow(clientId, clientSecret, scopes);

    // `result.scopes` is what Google GRANTED, which is not always what was asked for:
    // the consent screen lets the user untick individual permissions before approving.
    // Storing what was granted rather than what was requested means the call-time check
    // in factory/safety.ts tests what the token can actually do (ADR-202).
    //
    // `access` is stored because nothing else records what this account was authorized
    // FOR. The granted scopes say what the token can do; they do not say whether a human
    // chose to hold it back. `status` reads it, and the call-time policy in ADR-202 will.
    //
    // It is NOT needed to protect `refresh`: refreshAccessToken posts grant_type=
    // refresh_token with no scope parameter and never writes a credential, so a refresh
    // cannot widen anything. An earlier version of this comment claimed otherwise.
    await saveCredential(result.email, {
      type: 'authorized_user',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: result.refreshToken,
      scopes: result.scopes,
      access,
      ...(stillAllowWrites.length ? { stillAllowWrites } : {}),
    });

    invalidateToken(result.email);

    return {
      status: 'success',
      account: result.email,
      credentialPath: credentialPath(result.email),
    };
  } catch (err) {
    return {
      status: 'error',
      error: (err as Error).message,
      errorType: (err as Error).name,
    };
  }
}
