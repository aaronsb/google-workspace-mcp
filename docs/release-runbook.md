# Release Runbook

How to ship a new version of google-workspace-mcp.

## What Happens on Release

Pushing a `v*` tag triggers two CI workflows, publishing three channels:

| Workflow | File | What it does |
|----------|------|-------------|
| **Build .mcpb** | `.github/workflows/release-mcpb.yml` | Builds the .mcpb bundle and attaches it to the GitHub Release |
| **Publish** | `.github/workflows/npm-publish.yml` | Publishes to npm, then to the MCP Registry |

**Nothing needs publishing by hand.** Both npm and the MCP Registry go out from CI by
OIDC (ADR-105) — no `NPM_TOKEN`, no secret to rotate. The registry job `needs` the npm
job, because `server.json` advertises the npm package at that version and publishing the
registry entry first would point people at a tarball that does not exist yet.

The workflow picks the npm dist-tag itself: a pre-release publishes under `alpha`/`beta`/
`rc`, never `latest`, or every `npm install` and every `^x.y.z` range picks it up. It
reads the marker out of the version string, the same derivation `make publish-all` uses.

`make publish-all` still exists for publishing by hand if CI is unavailable. It is no
longer the normal path — running it after a tag would republish what CI already shipped.

> An earlier workflow published from a long-lived `NPM_TOKEN`. It expired in June 2026
> and failed three consecutive releases (v3.0.0, v4.0.0, v4.0.1) before being deleted in
> `2c5669c`, at which point publishing genuinely was manual. Trusted publishing by OIDC
> returned it to CI in `02df43e`, and `53b4c1b` added the MCP Registry beside it. This
> document described the gap between those commits until 2026-08-22.

## Release Flow

### 1. Ensure main is clean

```bash
git checkout main && git pull
make check          # types + all tests must pass
make coverage       # review API coverage gaps (advisory, non-blocking)
```

The coverage report shows what the manifest exposes vs Google's full published API surface. Review parameter gaps on covered operations — missing params like `supportsAllDrives` can cause user-facing issues. Run `make coverage-update` after adding new operations to refresh the baseline.

### 2. Bump version

```bash
# Pick one:
make release-patch  # x.y.Z — bug fixes
make release-minor  # x.Y.0 — new features
make release-major  # X.0.0 — breaking changes
```

`make release-*` runs `check`, bumps `package.json`, syncs version to `server.json` + `mcpb/manifest.json`, commits, tags, and pushes.

If `make check` fails (e.g., a flaky test), fix it first. Don't skip the check — fix the test and commit before releasing.

### 3. Manual release (if make fails)

If `make release-*` fails partway through, complete manually:

```bash
npm version minor --no-git-tag-version   # or patch/major
make version-sync                         # sync to server.json + mcpb/manifest.json
git add package.json package-lock.json server.json mcpb/manifest.json
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push && git push --tags
```

### 4. Verify CI

```bash
gh run list --limit 3   # both the .mcpb build and the publish should be running
gh run watch <run-id>
```

Both workflows must be green. The publish job runs npm first and the MCP Registry after
it, so a red registry job on a green npm job means the package shipped and the registry
entry did not — those need checking separately in step 5.

### 5. Verify artifacts

Check the PUBLISHED artifact, not the repo it was built from — those are different
claims, and only one of them is what a user installs.

```bash
# npm — the right package name, and the dist-tag it landed under
npm view @aaronsb/google-workspace-mcp version dist-tags license

# and confirm the tarball a user would actually download carries the change
npm pack @aaronsb/google-workspace-mcp@X.Y.Z --pack-destination /tmp
tar tzf /tmp/aaronsb-google-workspace-mcp-X.Y.Z.tgz | grep -E 'LICENSE|NOTICE'

# GitHub Release
gh release view vX.Y.Z
```

The GitHub Release should have exactly one `.mcpb` file:
- `google-workspace-mcp.mcpb`

One bundle covers every platform: what ships is Node plus pure JavaScript, with no
native addons and nothing `os`/`cpu`-gated. Per-platform bundles would be
byte-identical, and the platform in the filename would promise a guarantee the build
does not make.

## Pre-release Versions

For alpha/beta/rc releases:

```bash
npm version preminor --preid alpha --no-git-tag-version
# → 2.2.0-alpha.0
make version-sync
# commit, tag, push as above
```

CI reads the pre-release marker out of the version string and publishes with `--tag alpha`
(or `beta`/`rc`) rather than `--tag latest`, so a pre-release is available to people who
ask for it and invisible to everyone else. `make publish-all` derives the same tag the
same way, for the hand-publish path.

## Retagging

If a tag was pushed before a fix was ready (e.g., tests failed in CI):

```bash
git tag -d vX.Y.Z                        # delete local tag
git push origin :refs/tags/vX.Y.Z        # delete remote tag
# fix the issue, commit, push
git tag -a vX.Y.Z -m "vX.Y.Z"           # retag on fixed commit
git push --tags                           # triggers CI again
```

## Local .mcpb Builds

For testing or manual distribution without CI:

```bash
make mcpb              # the bundle — one, for every platform
```

Requires `mcpb` CLI installed (`npm install -g @anthropic-ai/mcpb`).

Publishing to the mcpb registry is a separate, manual step — CI only handles GitHub Release artifacts.

## Version Files

The version lives in three places, kept in sync by `make version-sync`:

| File | Field | Purpose |
|------|-------|---------|
| `package.json` | `version` | Source of truth, npm |
| `server.json` | `version` | MCP server metadata |
| `mcpb/manifest.json` | `version` | .mcpb bundle metadata |

Never edit these manually — use `npm version` + `make version-sync`.
