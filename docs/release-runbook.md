# Release Runbook

How to ship a new version of google-workspace-mcp.

## What Happens on Release

A single `git tag` push triggers two CI workflows:

| Workflow | File | What it does |
|----------|------|-------------|
| **Publish to npm** | `.github/workflows/npm-publish.yml` | Builds, tests, publishes to npm with provenance |
| **Build .mcpb** | `.github/workflows/release-mcpb.yml` | Builds .mcpb bundles for 5 platforms, attaches to GitHub Release |

Both trigger on `push: tags: ['v*']`.

## Release Flow

### 1. Ensure main is clean

```bash
git checkout main && git pull
make check          # types + all tests must pass
```

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
gh run list --limit 3   # should show both workflows running
gh run watch <run-id>   # watch the npm publish
```

Check:
- npm publish: green, published to correct tag (latest vs alpha/beta/rc)
- .mcpb build: green, 5 artifacts attached to GitHub Release

### 5. Verify artifacts

```bash
# npm
npm view @anthropic-ai/google-workspace-mcp version

# GitHub Release
gh release view vX.Y.Z
```

The GitHub Release should have 5 `.mcpb` files:
- `google-workspace-mcp-darwin-arm64.mcpb`
- `google-workspace-mcp-darwin-x64.mcpb`
- `google-workspace-mcp-linux-arm64.mcpb`
- `google-workspace-mcp-linux-x64.mcpb`
- `google-workspace-mcp-windows-x64.mcpb`

## Pre-release Versions

For alpha/beta/rc releases:

```bash
npm version preminor --preid alpha --no-git-tag-version
# → 2.2.0-alpha.0
make version-sync
# commit, tag, push as above
```

npm-publish.yml auto-detects the pre-release tag from the version string and publishes with `--tag alpha` (or beta/rc) instead of `--tag latest`.

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
make mcpb              # current platform only
make mcpb-all          # all 5 platforms
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
