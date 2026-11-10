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
    said: "I don't think next should be the repos branch. how can we show the latest code but also have a managable release flow?"
    via: Claude Code session, 2026-11-10, reviewing a first draft that put candidates on a `next` branch; followed by "ok. let's do that" on the single-branch flow
  - evidence: "Every v* tag runs both publish workflows in full. npm-publish.yml already derives the npm dist-tag from the semver pre-release identifier, but its MCP Registry job had no pre-release guard, and release-mcpb.yml created every GitHub Release without --prerelease"
  - evidence: "#225, filed against v4.8.0, reports manage_drive share failing outright; a released version is the first place most users meet a change"
  - evidence: "Rehearsal of the Makefile targets against a local bare remote, 2026-11-10: a candidate promoted after further merges shipped without them; a failing gate during promotion left main checked out with no tag; a candidate cut before a hotfix was refused at promotion"
  - evidence: "Review of PR #226 reproduced four failures in the first implementation: promoting a candidate whose push had been rejected, a merge-back conflict on an edit next to a version line, a rejected promotion push leaving a local release tag, and a patch series colliding with a same-numbered hotfix. Each was re-run against the revised targets and now refuses or rolls back"
  - upstream: "npm version semantics: preminor/premajor/prepatch --preid rc yields X.Y.Z-rc.0, prerelease increments the trailing number, and a published version can never be republished"
  - upstream: "GitHub fires a release event of type released when a prerelease is converted to a full release, but the release keeps the tag it was created from"
  - precedent: ADR-105
agent:
  name: claude-code
  model: claude-opus-5-5
considered:
  - operator: aaronsb
    said: "I've read 226 and it seems as we discussed but lets run a reviewer against it too"
    via: "Claude Code session, 2026-11-10, after reading PR #226; the reviewer's findings were fixed in fe1088a"
status: accepted
date: 2026-11-10
deciders:
  - aaronsb
related:
  - ADR-105
---

# ADR-106: Release candidates tagged on main, promoted by a release tag

## Summary

- **Decided:** `main` stays the only long-lived branch and always carries the latest code. A release starts as a candidate, `X.Y.Z-rc.N`, tagged on `main` and published to npm under the `rc` dist-tag and as a GitHub prerelease, but not to the MCP Registry. `make promote` commits the final version on top of the candidate's commit, tags it `vX.Y.Z`, which publishes every channel, and merges that commit back into `main`.
- **Trades away:** Every release ships at least two npm versions; `main`'s history gains a merge commit whenever work landed during a candidate; no branch shows the released code, so that view is the tag and the GitHub Release.
- **One-way?** No. The Makefile targets and the workflow guards revert in one session. Candidate versions already on npm stay there, under `rc`, where nothing installs them by default.
- **Probes:** *Confident (rc-isolated):* a candidate never moves npm `latest`, the MCP Registry entry, or GitHub's "Latest release". *Confident (what-ships):* a release contains exactly the candidate's code plus its version files, whatever merged after the candidate. *Not confident (merge-back):* that a hotfix merged into `main` during a candidate stays rare enough that resolving its version-file conflict by hand is acceptable.
- **Inversion:** Between a release branch that freezes work and releasing whatever `main` holds. The answer is outside both: build the release on the candidate's commit, so `main` never freezes and the release is still what was tried.

## Context

ADR-105 made the tag the point of no return: pushing `vX.Y.Z` publishes npm, the MCP Registry and the GitHub Release from CI. That removed the human from the publish, and with it the only moment anyone tried the build before every user received it. A change is first exercised outside the test suite by whoever installs the released version.

The pieces of a pre-release path existed but were not connected. The npm job publishes any version containing `-` under its identifier rather than `latest`, so `4.9.0-rc.0` would land under `rc`. Nothing else knew about pre-releases: the registry job would advertise the candidate as the current server version, and the bundle workflow would create an ordinary GitHub Release that becomes "Latest".

`main` is the repository's default branch, what contributors target and what the GitHub front page shows. The project wants that page to show the latest code, so a candidate step cannot depend on moving development to another branch.

A GitHub prerelease can be converted to a full release, and that conversion fires a `released` event a workflow could publish on. It cannot serve as the promotion step: the release is bound to its tag, the tag names a commit whose version files say `X.Y.Z-rc.N`, and npm will never accept a second publish under that number.

## Decision

### 1. `main` is the only long-lived branch

Pull requests target `main`, and it carries the latest code. Releases are tags. What has shipped is visible as the tag, the GitHub Release marked "Latest", and the README inside the published npm package.

### 2. A candidate is `X.Y.Z-rc.N`, tagged on `main`

`make release-rc BUMP=patch|minor|major` starts a candidate series from a released version, producing `X.Y.Z-rc.0`. Run again without `BUMP`, it cuts the next candidate in the series. Each run gates on `make check`, commits `chore: release vX.Y.Z-rc.N`, tags it, and pushes `main` and the tag in one atomic push. `main`'s version files name the newest candidate until it is promoted.

### 3. A candidate publishes where only people asking for it look

A candidate tag runs the same workflows as a release, with differences keyed on a `-` in the tag:

| Channel | Release `vX.Y.Z` | Candidate `vX.Y.Z-rc.N` |
|---|---|---|
| npm | `latest` | `rc` (`npx @aaronsb/google-workspace-mcp@rc`) |
| GitHub Release | full release, becomes "Latest" | prerelease, with the `.mcpb` bundle |
| MCP Registry | published | not published |

A candidate is identifiable by its version string, its npm dist-tag, GitHub's prerelease badge and its absence from the registry. `make publish-all` applies the same rule on the manual path.

### 4. Promotion builds on the candidate's commit

`make promote`, run on `main`, promotes the candidate `main`'s version files name. It refuses unless local `main` equals `origin/main`, unless the candidate's tag is on origin at the same commit (so it was published and could be tried), unless the final version is still unreleased, and unless the newest release is contained in the candidate (decision 5).

It then builds the release in a throwaway worktree at the candidate's commit, with a clean `npm ci`, so the gate sees exactly the candidate's sources and dependencies. There it runs `make check`, commits the final version and tags `vX.Y.Z`. Back on `main` it merges the release commit and pushes `main` and the tag in one atomic push.

The released commit differs from the candidate only in its version files. Work merged to `main` after the candidate is not in the release; it reaches users through the next candidate. When nothing merged in between, the merge is a fast-forward. Otherwise the only files that can conflict are the version files, and the merge resolves them by keeping `main`'s content with the final version written in.

Every release target runs under one guard: if anything fails before the atomic push lands, including a push rejected because origin moved, the branch is reset to where it started and the tags the run created are deleted. A rejected push is recovered by pulling and running the target again.

The publish workflow re-runs the tests, type-check and build on the tagged commit before publishing, as ADR-105 requires of every tag.

### 5. A hotfix branches from the release tag

A fix that cannot wait for a candidate is committed on a branch cut from the release tag, and `make release-patch` releases it from there. The branch is then merged into `main`; if a candidate is in flight, `main` keeps its own version files in that merge. A candidate cut before the hotfix does not contain it, so `make promote` refuses that candidate and a new one is cut.

When the hotfix takes the number the open series was heading for (a `4.8.1-rc.N` series, then a `4.8.1` hotfix), that series can never be promoted. `make release-rc BUMP=patch` (or `minor`, `major`) then starts a new series from the released hotfix version, and `promote` and `release-rc` both name that way out.

`release-minor` and `release-major` are retired; a minor or major release goes through a candidate.

## Consequences

### Positive

- A release can be installed and used before it reaches `latest` and the registry, by anyone who asks for `@rc`.
- Contributors and the front page are unaffected: one branch, the latest code, pull requests where they always went.
- Merging continues while a candidate is tried, and none of it ships untried.
- A release cannot silently drop a hotfix that shipped after its candidate was cut.
- A failed release run leaves the checkout as it found it, so the operator never reconstructs state by hand.

### Negative

- Two npm versions per release at minimum, all permanent. `npm view` lists every candidate.
- The `rc` dist-tag keeps pointing at the last candidate after promotion, so `@rc` can be older than `latest` until the next series starts.
- `main`'s version files name a candidate between `release-rc` and `promote`, so a source checkout of `main` reports a pre-release version.
- Merging a hotfix into `main` during a candidate conflicts on the version files and needs resolving by hand.
- `promote` runs a full `npm ci` and gate in a fresh worktree, which takes minutes rather than seconds.

### Neutral

- The MCP Registry only ever sees released versions, so its history keeps the shape it has today.
- `make publish-all` keeps its role as the manual fallback for both kinds of tag.
- A hotfix branch is pushed to origin by `release-patch` and can be deleted once merged.

## Alternatives Considered

- **A `next` integration branch, with `main` holding released code.** The first draft of this record. It makes `main` the release history and lets `promote` fast-forward, but either the default branch shows released rather than latest code, or `next` becomes the default branch and the front page shows unreleased work under a name contributors must learn. Rejected by the operator in favour of one branch.
- **A `stable` branch that tracks released code beside `main`.** Gives a browsable branch equal to the last release, which the release tag already gives, at the cost of one more ref every release must move.
- **Promote by converting the GitHub prerelease to a release.** The `released` event fires, but the release still names the candidate's tag and commit, whose version is `X.Y.Z-rc.N`. Publishing from it would put a candidate version on `latest`; rewriting the version in CI would publish a build no tag names. Rejected.
- **Promote whatever `main` holds when the candidate holds up.** Simple, but ships everything merged during the trial without trying it, which is the problem candidates exist to solve.
- **Candidates on GitHub only, not npm.** Keeps npm's version list clean, at the cost of every tester downloading the `.mcpb` bundle or building from a tag. The operator chose npm, provided candidates are distinguishable; decision 3 is how they are.
- **Keep releasing from `main` with no candidate step.** Rejected: it leaves the released version as the first build anyone runs outside CI.
