---
contract: adr/v1
kind: decision
verb: change
capability: process
basis:
  - operator: aaronsb
    level: guided
    said: "maybe we adjust our git flow to support a stage branch and a prerelease version (so we can switch the flag to released) and on released, we run the full publish through npm"
    via: Claude Code session, 2026-11-10, while preparing v4.9.0 from main
  - operator: aaronsb
    level: directed
    said: "do rcs go to npm? yes, probably - as long as it's distinguishable as rcs"
    via: Claude Code session, 2026-11-10
  - operator: aaronsb
    level: directed
    said: "lets use next in our ci"
    via: Claude Code session, 2026-11-10, choosing between next and stage as the branch name
  - evidence: "Every v* tag runs both publish workflows in full. npm-publish.yml already derives the npm dist-tag from the semver pre-release identifier, but its MCP Registry job has no pre-release guard, and release-mcpb.yml creates the GitHub Release without --prerelease"
  - evidence: "ci.yml already runs on pushes and pull requests to a branch named next; the branch does not exist on the remote"
  - evidence: "#225, filed against v4.8.0, reports manage_drive share failing outright; a released version is the first place most users meet a change"
  - upstream: "npm version semantics: preminor/premajor/prepatch --preid rc yields X.Y.Z-rc.0, prerelease increments the trailing number, and a published version can never be republished"
  - upstream: "GitHub fires a release event of type released when a prerelease is converted to a full release, but the release keeps the tag it was created from"
  - precedent: ADR-105
agent:
  name: claude-code
  model: claude-opus-5-5
status: proposed
date: 2026-11-10
deciders:
  - aaronsb
related:
  - ADR-105
---

# ADR-106: Release candidates on next, promoted to main by a release tag

## Summary

- **Decided:** Work lands on `next`. A release starts as a candidate, `X.Y.Z-rc.N`, tagged on `next` and published to npm under the `rc` dist-tag and as a GitHub prerelease, but not to the MCP Registry. When a candidate holds, `make promote` gives the same commit's code its final version, fast-forwards `main` to it and tags `vX.Y.Z`, which publishes to every channel as a tag does today. `main` holds released code only.
- **Trades away:** Every release ships at least two npm versions; a fix found in a candidate costs another candidate before release; contributors must target `next`, and pull requests opened against `main` need retargeting.
- **One-way?** No. The branch, the Makefile targets and the workflow guards revert in one session. Candidate versions already on npm stay there, under `rc`, where nothing installs them by default.
- **Probes:** *Confident (rc-isolated):* a candidate never moves npm `latest`, the MCP Registry entry, or GitHub's "Latest release". *Not confident (default-branch):* that `next` should become the repository's default branch, which routes new pull requests there but also makes the GitHub front page show unreleased docs.
- **Inversion:** Between publishing everything on tag and publishing nothing until a flag flips. The answer is outside both: publish candidates where only people asking for them look, and make "released" a new tag carrying the final version, because a flag cannot change the version a build already carries.

## Context

ADR-105 made the tag the point of no return: pushing `vX.Y.Z` publishes npm, the MCP Registry and the GitHub Release from CI. That removed the human from the publish, and with it the only moment anyone tried the build before every user received it. A change is first exercised outside the test suite by whoever installs the released version.

The pieces of a pre-release path exist but have never been connected. The npm job publishes any version containing `-` under its identifier rather than `latest`, so `4.9.0-rc.0` would land under `rc`. Nothing else knows about pre-releases: the registry job would advertise the candidate as the current server version, and the bundle workflow would create an ordinary GitHub Release that becomes "Latest". CI already runs on a branch named `next` that does not exist.

A GitHub prerelease can be converted to a full release, and that conversion fires a `released` event a workflow could publish on. It cannot serve as the promotion step: the release is bound to its tag, the tag names a commit whose version files say `X.Y.Z-rc.N`, and npm will never accept a second publish under that number.

## Decision

### 1. `next` is the integration branch; `main` holds released code

Feature and fix pull requests target `next`. `main` moves only by promotion (decision 4) or by a hotfix (decision 5), so its tip is always the last release. CI already runs on both.

### 2. A candidate is `X.Y.Z-rc.N`, cut on `next`

`make release-rc BUMP=patch|minor|major` starts a candidate series from a released version, producing `X.Y.Z-rc.0`. Run again without `BUMP`, it cuts the next candidate in the series. Each run gates on `make check`, commits `chore: release vX.Y.Z-rc.N`, tags it and pushes `next` and the tag. The target refuses to run off `next`.

### 3. A candidate publishes where only people asking for it look

The candidate tag runs the same workflows as a release, with three differences, each keyed on a `-` in the tag:

| Channel | Release `vX.Y.Z` | Candidate `vX.Y.Z-rc.N` |
|---|---|---|
| npm | `latest` | `rc` (`npx @aaronsb/google-workspace-mcp@rc`) |
| GitHub Release | full release, becomes "Latest" | prerelease, with the `.mcpb` bundle |
| MCP Registry | published | not published |

A candidate is identifiable by its version string, its npm dist-tag, GitHub's prerelease badge and its absence from the registry. `make publish-all` applies the same rule on the manual path.

### 4. Promotion is a tag carrying the final version

`make promote`, run on `next`:

1. Refuses unless HEAD is the commit tagged by the current candidate, so what is promoted is what was tried. Anything that landed after the candidate needs a new candidate first.
2. Refuses unless `origin/main` is an ancestor of HEAD, so `main` can move without a merge commit.
3. Gates on `make check`, sets the version to `X.Y.Z`, commits `chore: release vX.Y.Z`, tags it, fast-forwards `main` to it and pushes both branches and the tag.

The released commit differs from the candidate only in its version files. The publish workflow re-runs the tests, type-check and build on it before publishing, as ADR-105 requires of every tag.

### 5. A hotfix goes to `main` and back into `next`

`make release-patch` remains for a fix that cannot wait for a candidate. It refuses to run off `main`, publishes as today, and its commit is merged into `next` afterwards so decision 4's fast-forward keeps holding. `release-minor` and `release-major` are retired; a minor or major release goes through a candidate.

## Consequences

### Positive

- A release can be installed and used before it reaches `latest` and the registry, by anyone who asks for `@rc`.
- Promotion cannot ship code that was never a candidate, because `make promote` checks the candidate tag against HEAD.
- `main` reads as the release history, and its tip is always what `latest` serves.
- Contributor pull requests can merge into `next` without each merge being a release decision.

### Negative

- Two npm versions per release at minimum, all permanent. `npm view` lists every candidate.
- The `rc` dist-tag keeps pointing at the last candidate after promotion, so `@rc` can be older than `latest` until the next series starts.
- A pull request opened against `main` lands outside the candidate flow unless retargeted.
- A hotfix that is not merged back into `next` blocks the next promotion until it is. The refusal names the cause, but someone has to do the merge.

### Neutral

- The MCP Registry only ever sees released versions, so its history keeps the shape it has today.
- `make publish-all` keeps its role as the manual fallback for both kinds of tag.
- The repository's default branch is a GitHub setting outside this decision's files. Making it `next` routes new pull requests there automatically; leaving it `main` keeps the front page on released docs and makes CONTRIBUTING.md the only signal.

## Alternatives Considered

- **Promote by converting the GitHub prerelease to a release.** The `released` event fires, but the release still names the candidate's tag and commit, whose version is `X.Y.Z-rc.N`. Publishing from it would put a candidate version on `latest`; rewriting the version in CI would publish a build no tag names. Rejected.
- **Tag the final version on `next` as a GitHub prerelease, and publish npm only on conversion.** This keeps one version per release, but a fix found during trial needs either a new patch number or a moved tag, and the trial build never reaches npm, so testing means installing a bundle by hand. Rejected in favour of numbered candidates on npm.
- **Candidates on GitHub only, not npm.** Keeps npm's version list clean, at the cost of every tester downloading the `.mcpb` bundle or building from a tag. The operator chose npm, provided candidates are distinguishable; decision 3 is how they are.
- **A branch named `stage`.** Equivalent in mechanics. `next` is what CI already watches and what npm and the wider ecosystem use for pre-release channels.
- **Keep releasing from `main` with no candidate step.** Rejected: it leaves the released version as the first build anyone runs outside CI.
