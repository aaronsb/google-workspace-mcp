# Service manifests

One file per service — the declarative registry for the tool factory (ADR-300, ADR-304).
Each file's YAML root *is* the service definition; the filename (minus `.yaml`) is the
service key. `loadManifest()` in `../generator.ts` enumerates this directory and assembles
the `Manifest`.

## Notes

- People (contacts) is excluded: the OAuth flow declares no contacts scope
  (see `SERVICE_SCOPES` in `../../accounts/oauth.ts`).
- Meet is supported — authorize it by including `meet` in the services list
  (`manage_accounts`, operation `scopes`).
