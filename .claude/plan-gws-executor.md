# Plan: gws Executor

The foundational layer that invokes `gws` CLI as a subprocess, routes credentials per-account, parses output, and maps errors.

## Components

### 1. GwsExecutor
Core subprocess wrapper.

- Spawns `gws` with args, captures stdout (JSON) and stderr (diagnostics)
- Sets `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` per invocation for account routing
- Returns parsed JSON or structured error
- Maps gws exit codes (0-5) to typed errors:
  - 0: success
  - 1: API error (4xx/5xx from Google)
  - 2: Auth error (expired, missing, invalid)
  - 3: Validation error (bad args, unknown service)
  - 4: Discovery error (can't fetch API schema)
  - 5: Internal error

Interface sketch:
```typescript
interface GwsResult {
  success: boolean;
  data?: any;
  error?: { code: number; message: string; reason: string };
}

async function execute(account: string, args: string[]): Promise<GwsResult>
```

### 2. CredentialBridge
Maps account registry to per-account credential files. Does NOT touch gws's own storage.

- Stores exported credentials in our namespace (see Storage Layout below)
- Provides path lookup: `getCredentialPath(email) → string`
- Auth flow: spawn `gws auth login` → capture URL → `xdg-open` → wait → `gws auth export` → save to our namespace
- gws's `~/.config/gws/` is theirs — we read from it (via `gws auth export`) but never write to it

### 3. AccountManager (slim)
Lightweight account registry — no token management, no refresh logic.

- List accounts
- Add account (triggers auth flow via CredentialBridge)
- Remove account
- Account metadata (email, category, description)

## File Structure

```
src/
  executor/
    gws.ts            # GwsExecutor — subprocess wrapper
    errors.ts         # Error types mapped from gws exit codes
  accounts/
    registry.ts       # AccountManager — account CRUD
    credentials.ts    # CredentialBridge — per-account credential routing
    auth.ts           # Auth flow — gws auth login + browser open
  index.ts            # Entry point
```

## Build Order

1. **errors.ts** — error types (no dependencies)
2. **gws.ts** — executor (depends on errors)
3. **credentials.ts** — credential bridge (depends on executor for `gws auth export`)
4. **auth.ts** — auth flow (depends on credentials, executor)
5. **registry.ts** — account manager (depends on credentials, auth)
6. Wire into MCP server shell (later phase)

## Storage Layout (XDG Compliant)

Respect `$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` if set, otherwise use defaults.
Our namespace: `google-workspace-mcp`. Separate from gws's `~/.config/gws/`.

```
$XDG_CONFIG_HOME/google-workspace-mcp/     # ~/.config/google-workspace-mcp/
  accounts.json                             # Account registry (email, category, description)

$XDG_DATA_HOME/google-workspace-mcp/       # ~/.local/share/google-workspace-mcp/
  credentials/
    aaronsb-gmail-com.json                  # Exported authorized_user JSON (0600)
    aaron-bockelie-com.json                 # One file per account

~/.config/gws/                             # gws's own namespace — DO NOT TOUCH
  credentials.enc                           # Their encrypted store
  client_secret.json                        # Their client config
  token_cache.json                          # Their token cache
```

### Path Resolution

```typescript
function configDir(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'google-workspace-mcp');
}

function dataDir(): string {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'google-workspace-mcp');
}

function credentialPath(email: string): string {
  const slug = email.replace(/@/g, '-').replace(/\./g, '-');
  return path.join(dataDir(), 'credentials', `${slug}.json`);
}
```

### Migration

Old path: `~/.mcp/google-workspace-mcp/` — not XDG compliant.
On first run, detect old layout and offer to migrate accounts.json + re-auth credentials.
Don't migrate old tokens — they're expired anyway. Just re-auth via gws.

## Key Decisions

- **No `open` npm package** — use `child_process.exec` with platform detection (`xdg-open`/`open`/`start`)
- **gws as npm dependency** — pin version in package.json, invoke via resolved `node_modules/.bin/gws` path
- **Plaintext per-account credentials** — `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` requires plaintext JSON. Stored with 0600 perms. Trade-off: less secure than gws's encrypted store, but necessary for multi-account routing.
- **Stderr filtering** — gws emits "Using keyring backend: keyring" on stderr. Filter/ignore diagnostic lines, only surface actual errors.
- **Do NOT set `GOOGLE_WORKSPACE_CLI_CLIENT_ID/SECRET` env vars** when using `CREDENTIALS_FILE` — the exported credential already contains client_id/secret. Setting the env vars overrides them and causes `invalid_client` errors.

## Validation Checklist

- [ ] Execute a gws command and parse JSON output
- [ ] Handle each exit code (0-5) correctly
- [ ] Route credentials for two different accounts in sequence
- [ ] Auth flow opens browser and stores credential
- [ ] Account registry CRUD works
