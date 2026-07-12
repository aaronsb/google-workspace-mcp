# v3.0.0

## ⚠️ Breaking: requires Node 22.12 or newer

This release raises the minimum Node version from 18.14.1 to **22.12**. Node 18 and Node 20 are both end-of-life (April 2025 and April 2026).

**This is why the version is 3.0.0 rather than 2.8.0.** Anyone on a `^2.x` range would otherwise have auto-received a release their server could not start. A major bump makes the upgrade a deliberate choice.

If you are below the floor, the server now tells you so in plain language and exits, rather than crashing with a stack trace from inside `node_modules`. Claude Desktop extension (`.mcpb`) users: the bundle runs the Node runtime your *host* provides — upgrade the app, not this server.

## New

- **Send-As aliases** — `manage_email` `send` accepts a `from` parameter for verified Gmail Send-As aliases. (#127)
- **Attachments on reply / replyAll** — `reply` and `replyAll` now honour `attachments`, `html`, and `draft`. Previously these were silently ignored: a reply with an attachment sent *live* and *without* the attachment. (#132, thanks @jeremyyowell)

## Security

- **Critical XSS patched** in the HTML email sanitisation path (`sanitize-html`, GHSA-rpr9-rxv7-x643). The production dependency tree went from **21 vulnerabilities (2 critical) to 0**.
- `sanitize-html` is now unpinned and current (`^2.17.6`), which the Node floor raise unblocked — its pure-ESM transitive cannot load on older Node.

## Under the hood

- Test runner migrated from Jest to Vitest (ADR-101). Jest had been silently running in CommonJS despite an ESM config, which meant a suite that failed to *load* reported as `0 failures` — **222 tests had stopped running while CI stayed green**. That class of blind spot is gone.
- Production code no longer accommodates the test runner: the `setModuleDir()` shim and five registry mocks that existed only to work around CJS Jest are deleted.
- New CI guards, each verified by injecting the failure it claims to catch: orphaned tests that run nowhere, type errors in test files, incomplete builds, and — the one that would have caught the crash above — the **published Node floor is now executed**, not merely advertised.

## Upgrading

```bash
npm install -g @aaronsb/google-workspace-mcp@3
```

Requires Node ≥22.12. Your OAuth credentials in `~/.config/gws` are unaffected.
