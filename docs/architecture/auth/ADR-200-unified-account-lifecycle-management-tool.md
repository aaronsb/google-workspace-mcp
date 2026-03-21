---
status: Accepted
date: 2026-03-14
deciders:
  - aaronsb
related:
  - ADR-201
---

# ADR-200: Unified account lifecycle management tool

## Context

Authentication is currently split across multiple concerns:

1. **gws CLI** handles OAuth login, credential encryption, token refresh, and Cloud project setup
2. **Our credential bridge** exports from gws's encrypted store to per-account plaintext files for routing
3. **Our account registry** tracks which accounts exist and their metadata
4. **The user** must manually run `gws auth setup` / `gws auth login` outside the MCP server

Pain points discovered during development:
- `gws auth export` masks credentials by default — requires `--unmasked` flag
- Stale `client_secret.json` in `~/.config/gws/` silently breaks credential file routing
- Re-auth is needed when client secrets change, but nothing detects this
- Users must know about `gws` directly to set up their Cloud project
- Token validity can't be checked without attempting an API call
- No way to re-scope an account (e.g., add Drive access to a Gmail-only auth)

The current `manage_accounts` tool has 3 operations (list, authenticate, remove). It's not enough to manage the full auth lifecycle.

## Decision

Expand `manage_accounts` into a full auth lifecycle CRUD tool wrapping `gws auth` commands. The user should never need to interact with `gws` directly.

### Operations

| Operation | Purpose | Wraps |
|---|---|---|
| `list` | Show all accounts with credential and scope status | Registry + `hasCredential()` + scope introspection |
| `setup` | First-time Cloud project creation (interactive) | `gws auth setup` via browser |
| `authenticate` | Add account or re-auth existing (browser flow) | `gws auth login` → `gws auth export --unmasked` → save |
| `remove` | Delete account, credentials, and registry entry | Registry + credential file deletion |
| `status` | Check token validity and authorized scopes for an account | `gws auth status` with credential routing |
| `refresh` | Re-export credential from gws encrypted store | `gws auth export --unmasked` → overwrite credential file |
| `scopes` | Re-authenticate with different scope selection | `gws auth login -s <services>` → re-export |

### Credential lifecycle

```
setup (once)           → Cloud project + OAuth client created
authenticate (per-acct) → gws auth login → export → save to XDG path
status (check)         → validate token, report scopes, detect staleness
refresh (repair)       → re-export from gws encrypted store
scopes (modify)        → re-auth with new scope selection
remove (cleanup)       → delete credential + registry entry
```

### Status enrichment

`list` should return actionable status per account:

```json
{
  "accounts": [
    {
      "email": "user@gmail.com",
      "category": "personal",
      "hasCredential": true,
      "tokenValid": true,
      "scopes": ["gmail.modify", "calendar", "drive"],
      "lastAuthenticated": "2026-03-14"
    }
  ]
}
```

### Client secret management

The `authenticate` operation should:
1. Accept `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from environment
2. Also accept them as tool parameters (for setup flows where env isn't configured)
3. Update `~/.config/gws/client_secret.json` when a new secret is provided, preventing the stale-secret bug

### Error guidance

Auth failures should return specific remediation:
- "Token expired" → suggest `{ "operation": "authenticate", "email": "..." }`
- "Invalid client" → suggest `{ "operation": "setup" }` or check client secret
- "Insufficient scopes" → suggest `{ "operation": "scopes", "email": "...", "services": "drive,gmail" }`

## Consequences

### Positive

- Users never need to know about `gws` CLI directly
- Auth issues are self-diagnosable via `status` operation
- Stale credentials detectable and repairable without manual intervention
- Scope changes don't require removing and re-adding accounts
- Next-steps guidance steers agents to the right remediation

### Negative

- More operations on a single tool (7 vs 3) — manageable given operation-based pattern
- `setup` operation involves browser interaction that's hard to automate for headless environments
- We become responsible for wrapping gws auth UX, including edge cases

### Neutral

- `client_secret.json` management adds a new responsibility outside our XDG namespace
- Token validity checks add an API call per `status` invocation
- The `setup` operation only works when `gcloud` CLI is installed

## Deferred

The following items from the original design are deferred to future work:

- **`setup` operation** — requires `gcloud` CLI and is hard to automate for headless/MCP environments. Users should run `gws auth setup` directly for first-time Cloud project creation.
- **`list` status enrichment** — calling `gws auth status` per account on every list is slow. The current list shows credential file presence; full status is available via the `status` operation.
- **Client secret as tool parameter** — currently sourced from env vars only. Accepting via tool params would require careful handling to avoid logging secrets in MCP request traces.

## Alternatives Considered

- **Separate `manage_auth` tool**: Splits account CRUD from auth lifecycle. Rejected because accounts and auth are the same domain — an account without auth is useless.
- **Expose gws directly**: Let users run `gws auth login` themselves. Rejected because it breaks the "never touch gws" principle and doesn't integrate with our multi-account registry.
- **Automatic token refresh on failure**: Catch auth errors in the executor and auto-refresh. Considered but deferred — this would be a silent retry that could mask real issues. Better to surface the problem and let the agent/user decide.
