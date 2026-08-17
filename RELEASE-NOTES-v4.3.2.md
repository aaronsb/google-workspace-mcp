# v4.3.2

## Releases publish themselves now

**No functional change.** The server code in this release is identical to v4.3.0 — every
change here is to how releases are built and published. If you are running v4.3.0, there is
nothing to gain by upgrading.

It is tagged as a release because the new publishing path could only be proven by using it.

### What changed

Publishing moved from a laptop to CI, authenticated by **GitHub OIDC** on both channels.
There is no npm token, no stored secret, and no security key in the loop. GitHub mints a
short-lived credential scoped to one workflow file in one repository; npm matches it against
a trusted publisher, and the MCP Registry derives the namespace from the token's own
`repository_owner` claim.

Packages published this way carry a **SLSA provenance attestation**, which the manual path
never produced. You can verify what commit and workflow built the tarball you installed:

```
npm view @aaronsb/google-workspace-mcp@4.3.2
```

### Why

v4.3.0 was finished, reviewed and merged on one evening, then sat unreleased overnight
because publishing needed a physical security key that was not to hand. The next morning two
attempts failed before reaching any code, on terminal plumbing rather than on anything about
the package.

The MCP Registry told the same story more quietly: it held 2.7.1, 3.0.0, 4.0.0, 4.0.1, 4.2.0
and 4.2.1. **v4.1.0 was skipped entirely and nobody noticed**, because that step depended on
someone remembering to run it.

A release step that needs a human present is a step that eventually does not happen.

### Also

- `actions/checkout` and `actions/setup-node` upgraded v4 → v7; they were three majors
  behind and still targeting the retired Node 20 runtime. Builds and tests now run on Node 24.
- The supported Node floor is **unchanged at 22.12.0**, and the CI jobs that prove the server
  starts above it and refuses below it still pin 22.12.0 and 20.19.0 exactly.
- Re-running a publish on an already-published version is now a no-op on both channels,
  rather than a red X on a release that actually succeeded.

Reasoning recorded in `docs/architecture/core/ADR-105`.
