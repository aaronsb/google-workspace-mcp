# Service manifests

One file per service — the declarative registry for the tool factory (ADR-300, ADR-304).
Each file's YAML root *is* the service definition; the filename (minus `.yaml`) is the
service key. `loadManifest()` in `../generator.ts` enumerates this directory and assembles
the `Manifest`.

## Notes

- People (contacts) are supported by gws but excluded here because `gws auth login` does not
  offer the `contacts.readonly` scope — see https://github.com/googleworkspace/cli/issues/556
- Meet scopes are resolved — authorize with `gws auth login -s ...,meet`.
