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
 * A service is missing from this map when Google offers no read-only scope for it. That
 * is NOT treated as "use the read/write scope and say nothing": someone who asked for
 * read access would get write access without being told. `scopesForServices` reports
 * those services instead, so the person consenting can be told before the browser opens
 * (ADR-202).
 *
 * Every service currently has an entry, so nothing is granted more than was asked for
 * today. The reporting path still exists because the next service added may not have
 * one, and finding that out from a silently broad token is the wrong way to find out.
 *
 * Measured against descriptor.json rather than assumed:
 *
 * - calendar, docs, gmail, tasks — the scope below covers every GET method exposed.
 * - meet — `meetings.space.readonly` alone authorizes all eleven operations
 *   manage_meet exposes, every one a GET. The read/write entry also carries
 *   `meetings.space.created` and `.settings`, which exist for CREATING and configuring
 *   meeting spaces; this tool never does either. Reading "no read-only variant" off that
 *   scope list, rather than off what the operations need, is what nearly left meet out.
 * - drive, sheets — two GET methods and one respectively that no read-only scope covers,
 *   so read access there allows less than full access but slightly more than reading.
 */
export const SERVICE_SCOPE_MAP_READONLY: Record<string, string[]> = {
  gmail:    ['https://www.googleapis.com/auth/gmail.readonly'],
  drive:    ['https://www.googleapis.com/auth/drive.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
  sheets:   ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  docs:     ['https://www.googleapis.com/auth/documents.readonly'],
  tasks:    ['https://www.googleapis.com/auth/tasks.readonly'],
  slides:   ['https://www.googleapis.com/auth/presentations.readonly'],
  meet:     ['https://www.googleapis.com/auth/meetings.space.readonly'],
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

/** The scopes to request, plus any service that did not get the access level asked for. */
export interface ResolvedScopes {
  scopes: string[];
  /**
   * Services asked for as read-only that will still be able to write, because Google
   * offers no read-only scope for them. Always empty when asking for read/write.
   *
   * The caller has to tell the user about these. It is the difference between "you asked
   * for read access and got read access" and "you asked for read access and part of this
   * can still change your data".
   */
  stillAllowWrites: string[];
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
  const stillAllowWrites: string[] = [];

  for (const name of names) {
    const readwrite = SERVICE_SCOPE_MAP[name];
    if (!readwrite) {
      throw new Error(`Unknown service: '${name}'. Known: ${Object.keys(SERVICE_SCOPE_MAP).join(', ')}`);
    }

    // Read access uses the read-only scope where Google offers one. Where it does not,
    // the service keeps its read/write scope AND is reported — see
    // SERVICE_SCOPE_MAP_READONLY.
    const readonly = access === 'read' ? SERVICE_SCOPE_MAP_READONLY[name] : undefined;
    if (access === 'read' && !readonly) stillAllowWrites.push(name);

    for (const scope of readonly ?? readwrite) scopes.add(scope);
  }

  return { scopes: [...scopes], stillAllowWrites };
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
