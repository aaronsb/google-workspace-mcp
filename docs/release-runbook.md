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

The workflow picks the npm dist-tag itself: any pre-release (anything after `-` in the
version, per semver) publishes under its identifier — `alpha`, `beta`, `rc`, `pre`,
`next` — never `latest`, or every `npm install` and every `^x.y.z` range picks it up.
`make publish-all` uses the same derivation.

`make publish-all` still exists for publishing by hand if CI is unavailable. It is no
longer the normal path — running it after a tag would republish what CI already shipped.

> An earlier workflow published from a long-lived `NPM_TOKEN`. It expired in June 2026
> and failed three consecutive releases (v3.0.0, v4.0.0, v4.0.1) before being deleted in
> `2c5669c`, at which point publishing genuinely was manual. Trusted publishing by OIDC
> returned it to CI in `02df43e`, and `53b4c1b` added the MCP Registry beside it. This
> document described the gap between those commits until 2026-08-22.

## Release Flow

Releases go through a candidate first (ADR-106). Work lands on `next`; a candidate `X.Y.Z-rc.N` is tagged there and published where only people asking for it look; `make promote` then gives the candidate's commit its final version, fast-forwards `main` to it and tags `vX.Y.Z`. `main` holds released code only.

| | Candidate `vX.Y.Z-rc.N` | Release `vX.Y.Z` |
|---|---|---|
| Cut by | `make release-rc` on `next` | `make promote` on `next` |
| npm dist-tag | `rc` | `latest` |
| GitHub Release | prerelease | full release, becomes "Latest" |
| MCP Registry | not published | published |

### 1. Check `next`

```bash
git switch next && git pull
make check          # types + all tests must pass
make coverage       # review API coverage gaps (advisory, non-blocking)
```

The coverage report shows what the manifest exposes vs Google's full published API surface. Review parameter gaps on covered operations — missing params like `supportsAllDrives` can cause user-facing issues. Run `make coverage-update` after adding new operations to refresh the baseline.

### 2. Cut a candidate

```bash
make release-rc BUMP=minor   # first candidate of a series: 4.8.0 → 4.9.0-rc.0
make release-rc              # each later candidate: 4.9.0-rc.0 → 4.9.0-rc.1
```

`BUMP` is `patch`, `minor` or `major`, and is given only to start a series. The target refuses to run off `next`, with uncommitted changes, or behind `origin/next`. It runs `check`, bumps and syncs the version files, commits, tags, and pushes `next` and the tag in one atomic push.

Try the candidate as a user would:

```bash
npx @aaronsb/google-workspace-mcp@rc
```

A fix found while trying it lands on `next` like any other change, and a new candidate follows.

### 3. Promote

```bash
make promote
```

`promote` refuses unless HEAD is the commit the current candidate tag names, so what ships is what was tried; anything that landed after the candidate needs a new candidate first. It also refuses unless `origin/main` is an ancestor of HEAD, which a hotfix not yet merged back into `next` breaks. It then runs `check`, sets the final version, commits, tags, and pushes `next`, `main` and the tag in one atomic push.

If `make check` fails (e.g., a flaky test), fix it first. Don't skip the check — fix the test and commit before releasing.

### Hotfix

A fix that cannot wait for a candidate goes straight from `main`:

```bash
git switch main && git pull
# commit the fix on main
make release-patch
git switch next && git pull && git merge main && git push   # or the next promote refuses
```

### 4. Verify CI

```bash
gh run list --limit 3   # both the .mcpb build and the publish should be running
gh run watch <run-id>
```

Both workflows must be green. The publish job runs npm first and the MCP Registry after it, so a red registry job on a green npm job means the package shipped and the registry entry did not — those need checking separately in step 5. On a candidate the registry job shows as skipped.

### 5. Verify artifacts

Check the PUBLISHED artifact, not the repo it was built from — those are different claims, and only one of them is what a user installs.

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

One bundle covers every platform: what ships is Node plus pure JavaScript, with no native addons and nothing `os`/`cpu`-gated. Per-platform bundles would be byte-identical, and the platform in the filename would promise a guarantee the build does not make.

### If a target fails partway

Each target commits before it tags, and pushes the commit and tag together, so a failure before the push leaves only local state. Inspect it with `git log -1` and `git tag -l 'v*' --contains HEAD`. To start over, delete the local tag (`git tag -d vX.Y.Z-rc.N`) and reset the release commit (`git reset --hard HEAD~1`) before re-running the target.

## Other Pre-release Identifiers

CI derives the npm dist-tag from the semver pre-release identifier (anything after `-`), so an `alpha` or `beta` version published by hand lands under that tag rather than `latest`. Every pre-release, whatever its identifier, is a GitHub prerelease and stays off the MCP Registry. `make release-rc` cuts only `rc` versions; another identifier is set with `npm version` and `make version-sync`.

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
