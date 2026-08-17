import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { exec, execFile } from 'node:child_process';
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

/**
 * Service name → READ-ONLY scope URL(s), for accounts authorized with `access: 'read'`.
 *
 * A service is absent here when Google sells no read-only equivalent. Absence is
 * meaningful and is NEVER treated as "fall back to the read/write scope": granting write
 * to someone who asked for read is a silent over-grant, and authority is the last thing
 * that should widen quietly. `scopesForServices` reports the gap instead, so consent can
 * name it before the browser opens (ADR-202).
 *
 * `meet` is the live case. Its three scopes include `meetings.space.readonly`, but
 * `meetings.space.created` and `.settings` have no read-only form, so the service cannot
 * be narrowed as a whole.
 *
 * Measured against descriptor.json: for calendar, docs, gmail and tasks the scope below
 * authorizes every GET method the service exposes. drive has two GET methods and sheets
 * one that no read-only scope covers, so a read grant there is narrower than the service
 * without being literally reads-only.
 */
export const SERVICE_SCOPE_MAP_READONLY: Record<string, string[]> = {
  gmail:    ['https://www.googleapis.com/auth/gmail.readonly'],
  drive:    ['https://www.googleapis.com/auth/drive.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
  sheets:   ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  docs:     ['https://www.googleapis.com/auth/documents.readonly'],
  tasks:    ['https://www.googleapis.com/auth/tasks.readonly'],
  slides:   ['https://www.googleapis.com/auth/presentations.readonly'],
};

/** How much authority an account's token carries. */
export type AccessLevel = 'read' | 'readwrite';

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

/** What a scope resolution produced, including what it could NOT narrow. */
export interface ResolvedScopes {
  scopes: string[];
  /**
   * Services that were asked for read-only and have no read-only scope, so they carry
   * their full read/write scope. Empty for `readwrite`. The caller must surface this —
   * it is the difference between "you asked for read and got read" and "you asked for
   * read and part of this grant can write".
   */
  couldNotNarrow: string[];
}

/**
 * Convert comma-separated service names to deduplicated scope URLs.
 * Always includes base scopes (openid, userinfo.email).
 *
 * `access` defaults to 'readwrite', so every existing caller and every account
 * authorized before ADR-202 resolves exactly as it did.
 */
export function scopesForServices(
  services: string,
  access: AccessLevel = 'readwrite',
): ResolvedScopes {
  const names = services.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const scopes = new Set<string>(BASE_SCOPES);
  const couldNotNarrow: string[] = [];

  for (const name of names) {
    const readwrite = SERVICE_SCOPE_MAP[name];
    if (!readwrite) {
      throw new Error(`Unknown service: '${name}'. Known: ${Object.keys(SERVICE_SCOPE_MAP).join(', ')}`);
    }

    // Read access uses the read-only scope where one exists. Where none does, the
    // service keeps its read/write scope AND says so — see SERVICE_SCOPE_MAP_READONLY.
    const readonly = access === 'read' ? SERVICE_SCOPE_MAP_READONLY[name] : undefined;
    if (access === 'read' && !readonly) couldNotNarrow.push(name);

    for (const scope of readonly ?? readwrite) scopes.add(scope);
  }

  return { scopes: [...scopes], couldNotNarrow };
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
    // eslint-disable-next-line prefer-const -- timer and cleanup have mutual references
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
      process.stderr.write(`[google-workspace-mcp] OAuth: opening browser for consent\n`);
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
  const onError = (err: Error | null) => {
    if (!err) return;
    process.stderr.write(`[google-workspace-mcp] Failed to open browser: ${err.message}\n`);
    process.stderr.write(`[google-workspace-mcp] Open this URL manually:\n${url}\n`);
  };

  if (platform() === 'win32') {
    // 'start' is a cmd.exe built-in, not a standalone executable —
    // must invoke via cmd /c. The empty "" is the window title argument
    // that start requires before a quoted URL.
    exec(`cmd /c start "" "${url}"`, onError);
  } else {
    const cmd = platform() === 'darwin' ? 'open' : 'xdg-open';
    execFile(cmd, [url], onError);
  }
}
