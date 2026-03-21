import { readCredential, saveCredential, hasCredential } from './credentials.js';
import { credentialPath } from '../executor/paths.js';
import { runOAuthFlow, scopesForServices, ALL_SERVICES } from './oauth.js';
import { getAccessToken, invalidateToken } from './token-service.js';

export interface AuthResult {
  status: 'success' | 'error';
  account?: string;
  credentialPath?: string;
  error?: string;
  errorType?: string;
}

export interface AccountStatus {
  email: string;
  tokenValid: boolean;
  scopes: string[];
  scopeCount: number;
  hasRefreshToken: boolean;
}

/**
 * Authenticate a new account via our own OAuth2 flow.
 * Requests all service scopes by default.
 */
export async function authenticateAccount(
  clientId: string,
  clientSecret: string,
): Promise<AuthResult> {
  const scopes = scopesForServices(ALL_SERVICES);
  return runOAuth(clientId, clientSecret, scopes);
}

/**
 * Re-authenticate with a specific set of services.
 * Used by the `scopes` operation as an escape hatch.
 */
export async function reauthWithServices(
  clientId: string,
  clientSecret: string,
  services: string,
): Promise<AuthResult> {
  const scopes = scopesForServices(services);
  return runOAuth(clientId, clientSecret, scopes);
}

/**
 * Check account status: token validity and granted scopes.
 * Reads scopes from the credential file (per-account, not from gws keyring).
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
  };
}

// --- Internal ---

async function runOAuth(
  clientId: string,
  clientSecret: string,
  scopes: string[],
): Promise<AuthResult> {
  try {
    const result = await runOAuthFlow(clientId, clientSecret, scopes);

    await saveCredential(result.email, {
      type: 'authorized_user',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: result.refreshToken,
      scopes: result.scopes,
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
