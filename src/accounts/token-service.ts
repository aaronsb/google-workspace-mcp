import { readCredential } from './credentials.js';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EXPIRY_BUFFER = 60_000; // refresh 1 minute before expiry

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/** In-memory access token cache — lives for the MCP session. */
const cache = new Map<string, CachedToken>();

export class TokenRefreshError extends Error {
  constructor(
    message: string,
    public readonly email: string,
    public readonly googleError?: string,
  ) {
    super(message);
    this.name = 'TokenRefreshError';
  }
}

/**
 * Get a valid access token for an account.
 *
 * Returns from cache if >60s remaining, otherwise exchanges
 * the stored refresh token for a fresh access token.
 */
export async function getAccessToken(email: string): Promise<string> {
  const cached = cache.get(email);
  if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER) {
    return cached.accessToken;
  }

  const credential = await readCredential(email);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credential.client_id,
      client_secret: credential.client_secret,
      refresh_token: credential.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const googleError = body.error as string | undefined;

    if (response.status === 400 && googleError === 'invalid_grant') {
      cache.delete(email);
      throw new TokenRefreshError(
        `Refresh token revoked or expired for ${email}. Re-authenticate with manage_accounts → authenticate.`,
        email,
        googleError,
      );
    }

    throw new TokenRefreshError(
      `Token refresh failed for ${email} (${response.status}): ${JSON.stringify(body)}`,
      email,
      googleError,
    );
  }

  const data = await response.json() as {
    access_token: string;
    expires_in: number;
  };

  cache.set(email, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  });

  return data.access_token;
}

/** Evict a cached token — forces next getAccessToken to refresh. */
export function invalidateToken(email: string): void {
  cache.delete(email);
}

/** Prefetch tokens for all given accounts (fire-and-forget, logs errors). */
export async function warmTokenCache(emails: string[]): Promise<void> {
  const results = await Promise.allSettled(
    emails.map(email => getAccessToken(email)),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      process.stderr.write(
        `[gws-mcp] token warmup failed for ${emails[i]}: ${(result.reason as Error).message}\n`,
      );
    }
  }
}

/** Visible for testing — clear the entire cache. */
export function _clearCache(): void {
  cache.clear();
}
