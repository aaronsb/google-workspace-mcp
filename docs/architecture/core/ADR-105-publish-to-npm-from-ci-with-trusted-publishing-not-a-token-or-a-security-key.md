---
status: Accepted
date: 2026-08-17
deciders:
  - aaronsb
related: []
---

# ADR-105: Publish to npm from CI with trusted publishing, not a token or a security key

## Context

Commit `2c5669c` (2026-07-12) deleted `.github/workflows/npm-publish.yml` and moved
publishing into `make publish-all`, run by hand. Its reasoning was sound and is quoted
here because this ADR reverses only half of it:

> The workflow published to npm from a long-lived NPM_TOKEN. The token expired in June and
> the job has failed on three consecutive releases — v3.0.0, v4.0.0, v4.0.1 — while the
> manual `make publish-all` did the actual publishing each time.
>
> A workflow that is always red is worse than no workflow … And the token itself is a
> liability — it can publish the package at any time, from anywhere, with no human present.

Both objections are about the **token**, not about CI. A stored `NPM_TOKEN` expires
silently, is replayable by anyone who obtains it, and grants publish rights unbounded by
time, repository, or workflow.

The arrangement that replaced it has its own cost, and v4.3.0 measured it:

- 2026-08-16: the release was written, reviewed and merged, then held unreleased overnight
  because the maintainer was not near the security key.
- 2026-08-17: two publish attempts failed before reaching any code. `make publish-all` read
  EOF from `read -p` in a non-tty and recorded it as a declined confirmation; the retry
  cleared that prompt and then died on `npm error code EOTP`, npm asking for a browser
  round trip it had no terminal to hand off to.

Neither failure was about the package. Both were about requiring a human, a browser and a
tty at the moment of publish.

npm's **trusted publishing** removes the token without restoring the liability. GitHub
Actions presents an OIDC identity, npm verifies it against a publisher the package owner
registered, and mints a credential that is short-lived and scoped to one workflow file in
one repository. There is no secret in the repository, nothing to expire, and nothing to
rotate. A stolen credential is worthless off that workflow.

The trusted publisher for `@aaronsb/google-workspace-mcp` is already registered on
npmjs.com, naming `npm-publish.yml`. Only the workflow file is missing.

## Decision

Publish the npm package from CI on tag push, authenticated by GitHub OIDC.

1. Restore `.github/workflows/npm-publish.yml` at exactly that filename — the registered
   trusted publisher names the file, so renaming it silently breaks authentication.
2. Authenticate by OIDC alone. No `NODE_AUTH_TOKEN`, no `secrets.NPM_TOKEN`, and no
   `registry-url:` on `setup-node` (which exists to write a token into `.npmrc`).
3. Upgrade npm in the job before publishing. Trusted publishing requires npm >= 11.5.1 and
   Node 22 ships npm 10.x, so without this step the job authenticates the old way and fails.
4. Keep `--provenance`, which the deleted workflow already passed, and keep its dist-tag
   derivation so a pre-release cannot land on `latest`.
5. Run the gates in the job. The tag is not a promise that anything was checked.
6. Make `make publish-all` skip a version already on the registry rather than fail on it,
   so the manual path stays usable as a fallback without colliding with CI.

`make publish-all` is retained. It is the path when npm's OIDC is unavailable or a publish
must happen off a tag, and it is the only path for the MCP Registry until that half is
converted too.

## Consequences

### Positive

- A release no longer waits on one person holding one piece of hardware.
- No publish secret exists in the repository or in GitHub, so none can expire mid-release
  or leak. The failure that produced three consecutive red releases cannot recur in this
  form.
- Publishing runs the gates on the tagged commit, in a clean checkout, rather than from a
  working tree that merely resembles it.
- `--provenance` becomes reliable rather than dependent on the manual path being used.

### Negative

- Tag push now publishes to npm. Tagging was already a partial publish — it creates the
  GitHub Release and uploads the bundle — and this widens it to the irreversible half, since
  an npm version cannot be republished. The tag becomes the point of no return.
- Authentication now depends on registry-side configuration that lives outside this repo and
  is invisible to it. A trusted publisher edited or removed on npmjs.com breaks releases with
  nothing in the codebase to show why. The workflow filename is load-bearing for the same
  reason.
- Two publish paths exist, and they can disagree about what has already shipped.

### Neutral

- The MCP Registry step still runs from `make publish-all` and still needs a human. This ADR
  does not convert it.
- The workflow must stay on a Node whose npm satisfies the trusted-publishing floor, which is
  a second version coupling in CI alongside `engines-floor`.

## Update — 2026-08-17: the MCP Registry half also converted

Written above: *"The MCP Registry step still runs from `make publish-all` and still needs a
human. This ADR does not convert it."* It does now, in the same workflow file, as a second
job gated on the npm job by `needs:`.

Two things settled it. `mcp-publisher` already ships a `github-oidc` login mode, and the
registry derives authority differently from npm: it reads the `repository_owner` claim out
of the OIDC token and grants `io.github.<owner>/*` from that alone. No registry-side
configuration exists to set up — and equally, none exists to protect the namespace if this
repository's owner ever changes.

The evidence that the manual step was worth removing was already on the registry: it held
2.7.1, 3.0.0, 4.0.0, 4.0.1, 4.2.0 and 4.2.1 — **v4.1.0 was skipped entirely and nothing
noticed**, because the step depended on someone remembering it. That is the same argument
this ADR made about the expired token, arriving by a different route.

Ordering is load-bearing: `server.json` advertises the npm package at the version being
released, so publishing the registry entry before npm would point people at a tarball that
does not exist. The registry job also asserts `server.json`'s two version fields against the
tag, since `version-sync` writing them and the tag naming them are separate facts.

`make publish-all` remains the fallback for both channels, and its registry step now skips a
version already published, matching what its npm step does.

## Alternatives Considered

- **Keep publishing by hand.** Rejected: it is what produced the v4.3.0 delay and both
  failed attempts. The security-key ceremony protects against a stolen token, and under
  trusted publishing there is no token to steal.
- **A fresh long-lived NPM_TOKEN.** Rejected for the reasons in `2c5669c`, which have not
  changed: it expires silently, and it publishes from anywhere with no human present.
- **A granular token with a short expiry.** Rejected: it narrows the blast radius without
  removing the secret, and a token that expires on a schedule fails on whichever release
  happens to follow the expiry — the exact v3.0.0/v4.0.0/v4.0.1 failure, on a timer.
- **Publish from CI on a manual `workflow_dispatch` instead of on tag.** Rejected: it keeps
  a human in the loop for scheduling while removing them from the security decision, which
  is the opposite of the split that matters. A dispatched run also uses the workflow file
  from the dispatched ref, so it cannot publish a tag cut before the workflow existed.
