---
status: Accepted
date: 2026-03-20
deciders:
  - aaronsb
related:
  - ADR-200
---

# ADR-201: Own OAuth flow with per-account token service

## Context

ADR-200 established `manage_accounts` as the unified auth lifecycle tool, wrapping `gws auth login` and `gws auth export` for credential acquisition. In practice, this approach has a fundamental flaw: **gws CLI has a single-account keyring**.

Each `gws auth login` overwrites the previous token in gws's encrypted store. `gws auth export` always returns the last-authenticated credential regardless of which account is intended. In a multi-account setup, credential files silently contain the wrong refresh token.

**Confirmed bug:** `bockeliea@praecipio.com` credential file resolved to `aaronsb@gmail.com` because gws export returned the wrong token after a re-auth sequence. Drive queries for the Workspace account returned personal Gmail Drive content.

The root cause is architectural — we cannot safely use a single-account tool for multi-account credential management. No amount of sequencing or locking around `gws auth export` can guarantee correctness because gws offers no per-account export parameter.

## Decision

Replace gws's auth subsystem with our own OAuth2 authorization code flow. gws continues to execute all API calls — we only replace how tokens are acquired, stored, and delivered.

### OAuth flow (`src/accounts/oauth.ts`)

We run the standard OAuth2 authorization code grant ourselves:

1. Start an HTTP server on `127.0.0.1` port 0 (OS-assigned random port)
2. Build the Google consent URL with `access_type=offline`, `prompt=consent`, and a random `state` parameter for CSRF protection
3. Open the user's browser to the consent screen
4. Handle the redirect callback, validate state, extract the authorization code
5. Exchange the code at `https://oauth2.googleapis.com/token` for tokens
6. Resolve the authenticated user's email via `https://www.googleapis.com/oauth2/v3/userinfo`
7. Write the credential file directly — no gws involvement

The callback server has a 5-minute timeout and binds to localhost only.

### Scope mapping

A `SERVICE_SCOPE_MAP` constant maps service names to OAuth scope URLs. `scopesForServices("gmail,drive,meet")` produces deduplicated scope URLs plus base scopes (`openid`, `userinfo.email`). Default authentication requests all services at once — one consent screen, full access.

### Token service (`src/accounts/token-service.ts`)

An in-memory `Map<email, {accessToken, expiresAt}>` caches short-lived access tokens for the MCP session lifetime. `getAccessToken(email)` returns a cached token if >60 seconds remain, otherwise exchanges the stored refresh token at Google's token endpoint. Client credentials (client_id, client_secret) are read from the per-account credential file — no environment variable dependency at the execution layer.

### Credential delivery to gws

The executor switches from `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` (gws reads the file and refreshes internally) to `GOOGLE_WORKSPACE_CLI_TOKEN` (we provide a pre-minted access token). gws uses the token directly without touching its own auth subsystem.

```
# Before (broken for multi-account):
env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = credentialPath(account)

# After:
env.GOOGLE_WORKSPACE_CLI_TOKEN = await getAccessToken(account)
```

### Credential file format

Extended with optional `scopes` field for per-account scope tracking:

```json
{
  "type": "authorized_user",
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "...",
  "scopes": ["https://www.googleapis.com/auth/gmail.modify", "..."]
}
```

Existing files without `scopes` continue to work — the field is read as `[]` when absent. No migration needed.

### Status checking

`checkAccountStatus` reads scopes from the credential file (per-account, not from gws's keyring) and validates the token by attempting a refresh via the token service. This replaces the previous approach of making a Gmail API probe call.

### Startup warmup

The server prefetches access tokens for all registered accounts at startup via `warmTokenCache()`. This runs non-blocking after the MCP handshake, so the first tool call for each account is a cache hit.

## Consequences

### Positive

- **Multi-account correctness** — each account's refresh token is written directly by the OAuth flow that acquired it. No shared keyring, no export race.
- **Per-account scopes** — stored in the credential file, not inferred from gws's global state.
- **Faster execution** — access tokens are cached in memory. gws no longer does its own token refresh on every spawned process.
- **No gws auth dependency** — `auth.ts` and `credentials.ts` no longer import from the executor. The auth layer is fully independent of the API execution layer.

### Negative

- **We own token refresh** — if Google changes their token endpoint behavior, we need to handle it. Previously gws abstracted this.
- **Access tokens in environment** — `GOOGLE_WORKSPACE_CLI_TOKEN` is visible to the gws child process environment. The token is short-lived (~1 hour) and the process is local, but it's a different trust model than a file path.
- **Localhost callback server** — briefly opens a port. Bound to 127.0.0.1 only, random port, 5-minute timeout, but it's a listening socket during auth.

### Neutral

- ADR-200's operation surface (list, authenticate, remove, status, refresh, scopes) remains unchanged. Only the internal implementation changes.
- The `setup` operation (deferred in ADR-200) remains deferred — users still need a GCP project with OAuth credentials.
- Integration tests now exercise the real token refresh path, which is more thorough than before.

## Alternatives considered

- **Lock around gws auth export** — serialize auth operations so only one account auths at a time, then immediately export. Rejected: still fragile (any external `gws auth login` would corrupt the sequence), and doesn't solve the per-account scope tracking problem.
- **Patch gws to support per-account export** — upstream feature request. Rejected as a dependency: we can't wait for upstream, and the fix is straightforward to own.
- **Use Google client libraries directly** — replace gws entirely with googleapis npm packages for API calls. Rejected as scope creep: gws handles discovery, pagination, media upload, and CLI helpers well. We only needed to replace the auth, not the API execution engine.
