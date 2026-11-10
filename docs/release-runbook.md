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
It publishes the checked-out commit, so run it from `git switch --detach vX.Y.Z`: after a
promotion that merged, `main` is a merge commit and the tag guard refuses there.

> An earlier workflow published from a long-lived `NPM_TOKEN`. It expired in June 2026
> and failed three consecutive releases (v3.0.0, v4.0.0, v4.0.1) before being deleted in
> `2c5669c`, at which point publishing genuinely was manual. Trusted publishing by OIDC
> returned it to CI in `02df43e`, and `53b4c1b` added the MCP Registry beside it. This
> document described the gap between those commits until 2026-08-22.

## Release Flow

Releases go through a candidate first (ADR-106). `main` is the only long-lived branch and carries the latest code. A candidate `X.Y.Z-rc.N` is tagged on `main` and published where only people asking for it look; `make promote` then commits the final version on top of the candidate's commit, tags `vX.Y.Z`, and merges that commit back into `main`.

| | Candidate `vX.Y.Z-rc.N` | Release `vX.Y.Z` |
|---|---|---|
| Cut by | `make release-rc` on `main` | `make promote` on `main` |
| npm dist-tag | `rc` | `latest` |
| GitHub Release | prerelease | full release, becomes "Latest" |
| MCP Registry | not published | published |

### 1. Check `main`

```bash
git checkout main && git pull
make check          # types + all tests must pass
make coverage       # review API coverage gaps (advisory, non-blocking)
```

The coverage report shows what the manifest exposes vs Google's full published API surface. Review parameter gaps on covered operations — missing params like `supportsAllDrives` can cause user-facing issues. Run `make coverage-update` after adding new operations to refresh the baseline.

### 2. Cut a candidate

```bash
make release-rc BUMP=minor   # first candidate of a series: 4.8.0 → 4.9.0-rc.0
make release-rc              # each later candidate: 4.9.0-rc.0 → 4.9.0-rc.1
```

`BUMP` is `patch`, `minor` or `major`, and is given only to start a series. The target refuses to run off `main`, with uncommitted changes, or behind `origin/main`. It runs `check`, bumps and syncs the version files, commits, tags, and pushes `main` and the tag in one atomic push.

Try the candidate as a user would:

```bash
npx @aaronsb/google-workspace-mcp@rc
```

Pull requests keep merging while the candidate is tried. A fix the candidate needs lands on `main` like any other change, and a new candidate follows.

### 3. Promote

```bash
make promote
```

`promote` takes the candidate `main`'s version files name (the newest one) and builds the release on that candidate's commit, so the release is exactly what was tried. Anything merged after the candidate stays on `main` for the next series; the target says how many commits that is.

It refuses when:

- local `main` differs from `origin/main` — pull, or push what is yours;
- the candidate's tag is not on origin, so it was never published — cut a new candidate;
- the final version is already released, because a hotfix took the number — run `make release-rc BUMP=patch` to start a new series from it;
- a hotfix was released after the candidate was cut, so the candidate lacks it — cut a new candidate.

It builds the release in a throwaway worktree at the candidate with a clean `npm ci` and runs `check` there, which takes a few minutes. It then commits the final version, tags it, merges the release commit into `main`, and pushes `main` and the tag in one atomic push. The merge is a fast-forward when nothing landed since the candidate; otherwise any conflict can only be in the version files, and the target resolves it by keeping `main`'s content with the final version written in.

If `make check` fails (e.g., a flaky test), fix it first. Don't skip the check — fix the test and commit before releasing.

### Hotfix

A fix that cannot wait for a candidate branches from the release it fixes:

```bash
git fetch --tags && git switch -c hotfix/X.Y.Z+1 vX.Y.Z
# For a release tagged before ADR-106 (v4.8.0 and earlier), bring in the current
# release targets first; the Makefile is not part of the published package.
git checkout origin/main -- Makefile && git commit -m "chore: release targets from main"
# commit the fix, then:
make release-patch           # tags vX.Y.Z+1 on this branch and pushes branch and tag
```

Then merge the branch into `main`:

```bash
git switch main && git pull && git merge hotfix/X.Y.Z+1
```

If a candidate is in flight, the merge conflicts on the version files. Keep `main`'s and finish the merge:

```bash
git checkout --ours package.json package-lock.json server.json mcpb/manifest.json src/version.ts
git add package.json package-lock.json server.json mcpb/manifest.json src/version.ts
git commit --no-edit && git push
```

Then cut a new candidate, since `promote` refuses one that lacks the hotfix. If the hotfix took the number the open series was heading for, `release-patch` says so; start the new series with `make release-rc BUMP=patch`.

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

Every release target restores the checkout when it fails before its atomic push lands: the branch goes back to where it started and the tags that run created are deleted. A push rejected because origin moved is one such failure; `git pull` (a merge, never a rebase, so no tagged commit is rewritten) and run the target again.

Once the push has landed, the release exists. A red CI run after that is handled in steps 4 and 5, or with `make publish-all`.

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
