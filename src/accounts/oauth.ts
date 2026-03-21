import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

const CALLBACK_TIMEOUT = 5 * 60_000; // 5 minutes

/** Service name → OAuth scope URL(s). */
export const SERVICE_SCOPE_MAP: Record<string, string[]> = {
  gmail:    ['https://www.googleapis.com/auth/gmail.modify'],
  drive:    ['https://www.googleapis.com/auth/drive'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  sheets:   ['https://www.googleapis.com/auth/spreadsheets'],
  docs:     ['https://www.googleapis.com/auth/documents'],
  tasks:    ['https://www.googleapis.com/auth/tasks'],
  slides:   ['https://www.googleapis.com/auth/presentations'],
  meet: [
    'https://www.googleapis.com/auth/meetings.space.created',
    'https://www.googleapis.com/auth/meetings.space.readonly',
    'https://www.googleapis.com/auth/meetings.space.settings',
  ],
};

const BASE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** All service names that have scope mappings. */
export const ALL_SERVICES = Object.keys(SERVICE_SCOPE_MAP).join(',');

export interface OAuthResult {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}

/**
 * Convert comma-separated service names to deduplicated scope URLs.
 * Always includes base scopes (openid, userinfo.email).
 */
export function scopesForServices(services: string): string[] {
  const names = services.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const scopes = new Set<string>(BASE_SCOPES);

  for (const name of names) {
    const mapped = SERVICE_SCOPE_MAP[name];
    if (!mapped) {
      throw new Error(`Unknown service: '${name}'. Known: ${Object.keys(SERVICE_SCOPE_MAP).join(', ')}`);
    }
    for (const scope of mapped) scopes.add(scope);
  }

  return [...scopes];
}

/**
 * Run a full OAuth2 authorization code flow with a localhost callback server.
 *
 * 1. Start HTTP server on a random port
 * 2. Open browser to Google consent screen
 * 3. Handle redirect callback, exchange code for tokens
 * 4. Resolve the authenticated user's email via userinfo
 */
export async function runOAuthFlow(
  clientId: string,
  clientSecret: string,
  scopes: string[],
): Promise<OAuthResult> {
  const state = randomBytes(16).toString('hex');

  const { code, redirectUri } = await listenForCallback(clientId, scopes, state);

  // Exchange authorization code for tokens
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${body}`);
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!tokenData.refresh_token) {
    throw new Error(
      'No refresh_token returned. This usually means the user did not grant offline access. ' +
      'Try revoking app access at https://myaccount.google.com/permissions and re-authenticating.',
    );
  }

  // Resolve email from userinfo
  const userinfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userinfoResponse.ok) {
    throw new Error(`Userinfo request failed (${userinfoResponse.status})`);
  }

  const userinfo = await userinfoResponse.json() as { email: string };

  return {
    email: userinfo.email,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in,
    scopes: tokenData.scope.split(' '),
  };
}

// --- Internal ---

function listenForCallback(
  clientId: string,
  scopes: string[],
  state: string,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      // Ignore favicon and other requests
      if (!url.pathname.includes('callback') && url.pathname !== '/') {
        res.writeHead(404);
        res.end();
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication failed</h2><p>You can close this tab.</p></body></html>');
        cleanup();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (!code) return; // not the callback yet

      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Invalid state parameter</h2><p>Possible CSRF. Try again.</p></body></html>');
        cleanup();
        reject(new Error('OAuth state mismatch — possible CSRF'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>Authentication successful</h2><p>You can close this tab.</p></body></html>');
      cleanup();
      resolve({ code, redirectUri });
    });

    let redirectUri = '';
    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind callback server'));
        return;
      }

      redirectUri = `http://127.0.0.1:${addr.port}/callback`;

      const authUrl = buildAuthUrl(clientId, redirectUri, scopes, state);
      process.stderr.write(`[gws-mcp] OAuth: opening browser for consent\n`);
      openBrowser(authUrl);
    });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('OAuth flow timed out — no callback received within 5 minutes'));
    }, CALLBACK_TIMEOUT);
  });
}

function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open'
            : platform() === 'win32' ? 'start'
            : 'xdg-open';
  execFile(cmd, [url], (err) => {
    if (err) process.stderr.write(`[gws-mcp] Failed to open browser: ${err.message}\n`);
  });
}
