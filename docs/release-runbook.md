# Release Runbook

How to ship a new version of google-workspace-mcp.

## What Happens on Release

Pushing a `v*` tag triggers one CI workflow:

| Workflow | File | What it does |
|----------|------|-------------|
| **Build .mcpb** | `.github/workflows/release-mcpb.yml` | Builds the .mcpb bundle and attaches it to the GitHub Release |

**npm is published by hand**, from `make publish-all`, authenticated interactively with a
security key.

There used to be a second workflow that published to npm from a long-lived `NPM_TOKEN`.
The token expired, and the job then failed on three consecutive releases while the manual
publish did the real work — a permanently-red workflow that nobody reads, which is worse
than no workflow at all. It is gone. Publishing with a security key is also stronger than
a token sitting in CI that can publish the package at any time, and there is no secret to
rotate.

The one thing that workflow did which the Makefile did not was pick the npm dist-tag: a
pre-release must publish under `alpha`/`beta`/`rc`, never `latest`, or every `npm install`
and every `^x.y.z` range picks it up. `make publish-all` now does that (see the `npm`
section of the target).

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
gh run list --limit 3   # the .mcpb build should be running
gh run watch <run-id>
```

Check the .mcpb build is green and the bundle is attached to the GitHub Release.

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

`make publish-all` reads the pre-release marker out of the version string and publishes
with `--tag alpha` (or `beta`/`rc`) rather than `--tag latest`, so a pre-release is
available to people who ask for it and invisible to everyone else.

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
