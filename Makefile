.DEFAULT_GOAL := help
.PHONY: help test test-all test-unit test-integration build clean typecheck lint smoke smoke-reject smoke-orphan check-gates check-node-floor \
        manifest-lint check-write-ops \
        coverage coverage-update \
        mcpb version-sync publish-all \
        release-patch release-minor release-major check

# Prerequisites in a target's list are only ordered when make runs serially. Under
# `make -j`, `smoke` could start while `build` was still mid-`tsc` (or inside its
# `rm -rf build/factory/manifest` window) and smoke-test the PREVIOUS build — a guard
# reporting on an artifact other than the one just produced. `version-stamp` rewrites
# src/version.ts, which a concurrent test run is reading. These targets are cheap;
# serialising them costs nothing and removes the class outright.
.NOTPARALLEL:

VERSION = $(shell node -p 'require("./package.json").version')

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# --- Build & Test ---

test: test-unit ## Run unit tests (default)

test-all: test-unit test-integration ## Run unit + integration tests

# Delegate to the npm scripts so the unit-test allowlist lives in exactly one
# place. That allowlist is deliberately not a denylist: a denylist would
# auto-enrol any future network-touching test into the `make check` CI gate.
test-unit: ## Run unit tests (mocked, fast, no network)
	npm run test

test-integration: ## Run integration tests (ACCOUNT=email optional)
	$(if $(ACCOUNT),TEST_ACCOUNT=$(ACCOUNT)) npm run test:integration

typecheck: ## Type-check src AND tests without emitting
	npm run type-check

# One definition, shared with `npm run version-stamp`. It used to live only here as
# an inline node -e, so `npm run build` — and therefore prepublishOnly — never
# stamped: publishing outside `make publish-all` shipped the PREVIOUS version.
version-stamp: ## Write version from package.json into src/version.ts
	@npm run version-stamp --silent

lint: ## Lint src/
	npm run lint

# Delegates rather than re-implementing `tsc && cp`: the npm script carries the
# version stamp AND a postbuild integrity check, and a copy of the recipe here
# would silently skip both.
build: ## Compile TypeScript to build/ (and verify the output)
	npm run build

check-write-ops: ## Assert every write op can carry a request body
	node scripts/check-write-ops.mjs

check-gates: ## Assert every test file is COLLECTED by some gate
	node scripts/check-test-gates.mjs

# The floor is written in three places (engines, the CI job that executes it, and the
# startup guard). A comment saying "keep in sync" is a coupling maintained by nobody.
check-node-floor: ## Assert the Node floor agrees everywhere it is declared
	node scripts/check-node-floor.mjs

# Depends on build: smoking a stale build/ is exactly the "measured the wrong
# artifact" failure this whole branch is about.
smoke: build ## Start the built server on a foreign cwd and assert it loads its tools
	node scripts/smoke-start.mjs

# Deliberately NOT in `check`: it must run on a Node BELOW the floor, which this dev box
# is not. It self-skips loudly rather than passing vacuously. CI runs it (engines-floor-reject),
# and check-node-floor fails the build if that job disappears.
smoke-reject: build ## Assert the server REFUSES a below-floor Node (run on Node <22.12)
	node scripts/smoke-reject.mjs

# The unit tests prove `isOrphaned` answers correctly; only this proves a real process
# tree reclaims itself. It runs the case with NO stdin EOF available, so deleting the
# watchdog fails here instead of passing on a signal that wasn't there (#149, ADR-104).
smoke-orphan: build ## Assert an orphaned server exits instead of pegging a CPU core
	node scripts/smoke-orphan.mjs

# Mirrors CI. `lint` used to be in the help text but not the prerequisites, so a
# contributor could go green locally and red in CI on a job this target claimed
# to cover.
check: typecheck lint check-gates check-node-floor check-write-ops test build smoke smoke-orphan ## Type-check, lint, test, build, smoke (CI gate)

clean: ## Remove build artifacts
	rm -rf build/ mcpb/server mcpb/LICENSE mcpb/NOTICE mcpb/LICENSE-MIT *.mcpb

# --- Manifest management ---

# Two jobs, two targets: `npm run generate-descriptor` reads Google's Discovery
# documents into src/google/descriptor.json, and `make coverage` reports what we
# expose against what Google actually offers. Neither derives the API surface from
# a checked-in snapshot — a target whose input can go stale on disk keeps "passing"
# locally while comparing against nothing on a fresh clone. See ADR-103.

manifest-lint: ## Validate manifest YAML syntax and structure
	@node -e " \
		const fs = require('fs'), path = require('path'); \
		const yaml = require('yaml'); \
		const dir = 'src/factory/manifest'; \
		const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort(); \
		let ops = 0; \
		for (const file of files) { \
			const svc = path.basename(file, '.yaml'); \
			const def = yaml.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); \
			const opCount = Object.keys(def.operations).length; \
			ops += opCount; \
			console.log('  ' + def.tool_name + ': ' + opCount + ' operations'); \
			for (const [opName, opDef] of Object.entries(def.operations)) { \
				if (!opDef.resource && !opDef.helper) \
					console.error('    ERROR: ' + svc + '.' + opName + ' has no resource or helper'); \
				if (!opDef.type) \
					console.error('    ERROR: ' + svc + '.' + opName + ' has no type'); \
				if (!opDef.description) \
					console.error('    ERROR: ' + svc + '.' + opName + ' has no description'); \
			} \
		} \
		console.log('  Total: ' + ops + ' operations across ' + files.length + ' services'); \
	"

# --- Coverage analysis ---

coverage: build ## Analyze Google API coverage vs curated manifest
	node build/coverage/analyze.js

coverage-update: build ## Update coverage baseline from Google's current surface
	node build/coverage/analyze.js --update

# --- MCPB packaging ---

# ONE bundle, not five.
#
# A per-platform build only earns its keep if the bundle carries platform-specific
# bytes. This one does not: what ships is Node + pure JavaScript — 112 production
# packages, zero native addons, zero `os`/`cpu`-gated packages. So `mcpb-all` was
# packing the SAME BYTES five times and labelling them darwin-arm64, darwin-x64,
# linux-arm64, linux-x64 and windows-x64 — measured, not assumed: two of those
# bundles built out to 3191 files each under an identical content hash.
#
# That was worse than redundant, it was a lie a user could act on. Someone on an M1 who
# grabbed `darwin-arm64` got a bundle whose `npm ci --omit=dev` had been resolved on
# whatever machine ran the release — a GitHub ubuntu-latest runner. It worked only
# because nothing in the tree is platform-specific. The name promised a guarantee the
# build never made.
mcpb: build ## Build the .mcpb bundle (one bundle, all platforms)
	@echo "Building mcpb v$(VERSION) — pure JS, one bundle for every platform"
	rm -rf mcpb/server
	mkdir -p mcpb/server
	cp -r build/* mcpb/server/
	cp package.json package-lock.json mcpb/server/
	cd mcpb/server && npm ci --omit=dev --ignore-scripts --silent
	rm -f mcpb/server/package-lock.json
	@# The bundle ships NO full package.json, but the built output is ESM and the entry
	@# uses top-level await. With nothing declaring "type": "module", Node falls back to
	@# module-syntax DETECTION (default-on only since 20.19/22.7) — and on any host
	@# without it the entrypoint dies with a raw SyntaxError before our version guard can
	@# run, on exactly the runtimes that guard exists for. Make the bundle explicitly ESM.
	@node -e "require('fs').writeFileSync('mcpb/server/package.json', JSON.stringify({type:'module'}, null, 2) + '\n')"
	@echo "  mcpb/server/package.json → {\"type\": \"module\"}"
	@# The bundle is a DISTRIBUTION, so the licence travels with it. Apache-2.0 4(d)
	@# requires a redistributed work to carry its NOTICE, and MIT requires its notice to
	@# accompany the code it covers (the pre-3.0 history — see LICENSE-MIT). A bundle
	@# that ships the code and drops the notices does not satisfy either.
	cp LICENSE NOTICE LICENSE-MIT mcpb/
	mcpb pack mcpb google-workspace-mcp.mcpb
	node scripts/verify-mcpb.cjs google-workspace-mcp.mcpb
	@echo ""
	@echo "Built: google-workspace-mcp.mcpb ($$(du -h google-workspace-mcp.mcpb | cut -f1))"

# --- Version & Release ---

version-sync: ## Sync version from package.json → server.json + mcpb/manifest.json
	@echo "Syncing version $(VERSION) to server.json and mcpb/manifest.json"
	@node scripts/version-sync.cjs

release-patch: check ## Bump patch, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version patch --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

release-minor: check ## Bump minor, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version minor --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

release-major: check ## Bump major, sync, commit, tag, push
	@echo "Current version: $(VERSION)"
	npm version major --no-git-tag-version
	$(MAKE) version-sync
	$(MAKE) _release-commit

_release-commit:
	$(eval NEW_VERSION := $(shell node -p 'require("./package.json").version'))
	git add package.json package-lock.json server.json mcpb/manifest.json src/version.ts
	git commit -m "chore: release v$(NEW_VERSION)"
	git tag -a "v$(NEW_VERSION)" -m "v$(NEW_VERSION)"
	git push && git push --tags
	@echo ""
	@echo "Released v$(NEW_VERSION). The tag push publishes it — npm, the MCP Registry"
	@echo "and the GitHub Release all go out from CI by OIDC (ADR-105). Nothing to run."
	@echo ""
	@echo "  gh run list --limit 3     # both workflows should be green"
	@echo ""
	@echo "'make publish-all' is the fallback for when CI cannot do it, and running it"
	@echo "now would republish what CI already shipped."

# --- Publishing ---

check-release-tag: ## Refuse to publish unless v$(VERSION) is tagged AT the commit we are publishing
	@tag="v$(VERSION)"; \
	git rev-parse -q --verify "refs/tags/$$tag" >/dev/null || { \
	  echo "check-release-tag: no tag $$tag."; \
	  echo "  package.json says $(VERSION), but nothing is tagged for it."; \
	  echo "  Fix: git tag -a $$tag <release-commit> -m \"$$tag\""; exit 1; }; \
	tagged=$$(git rev-parse "$$tag^{}"); head=$$(git rev-parse HEAD); \
	if [ "$$tagged" != "$$head" ]; then \
	  echo "check-release-tag: $$tag points at $$(git log --oneline -1 $$tagged)"; \
	  echo "  but HEAD is        $$(git log --oneline -1 $$head)"; \
	  echo "  Publishing would ship HEAD's code under a tag that names a different commit."; \
	  echo "  (This is not hypothetical: v3.0.0 was first cut on the wrong commit.)"; exit 1; \
	fi; \
	echo "check-release-tag: $$tag -> $$(git log --oneline -1 $$tagged)"

# `read` is the ONLY thing here that needs a terminal. The hardware-key steps do not:
# npm's 2FA and `mcp-publisher login github` print a URL and wait on the browser, which
# works fine with no tty. So without YES=1 this target is unrunnable from anywhere that
# lacks one — Claude Code's `!` prefix, a pipeline, CI — because `read` gets EOF, which
# reads as "no" and aborts a publish that was never actually declined.
#
# YES=1 does not remove the confirmation, it moves it to the command line: typing it is
# the affirmative act. Publishing is still a one-way door and nothing here defaults to it.
# The FALLBACK path, for when CI cannot publish. The normal path is a tag push:
# npm-publish.yml ships npm and the MCP Registry by OIDC, release-mcpb.yml attaches
# the bundle. Run this after a successful tag and it republishes what already shipped.
publish-all: check-release-tag mcpb ## Publish by hand when CI cannot (normal path is the tag push)
	@echo ""
	@echo "Publishing v$(VERSION) to all channels BY HAND."
	@echo "CI already does this on a tag push — only continue if it could not."
	@echo "  1. npm (2FA in the browser — passkey/security key)"
	@echo "  2. MCP Registry (requires GitHub auth)"
	@echo "  3. GitHub Release (reconciles the one CI made on tag push)"
	@echo ""
	@if [ -n "$(YES)" ]; then echo "YES=1 — confirmed on the command line, not prompting."; \
	else read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || { echo "Aborted."; exit 1; }; fi
	@echo ""
	@echo "── npm ──"
	@# .github/workflows/npm-publish.yml publishes on tag push via OIDC (ADR-105), so by
	@# the time anyone runs this the version is usually already up. Skipping is the
	@# correct outcome, not a failure: an npm version is permanent, and `npm publish`
	@# over an existing one exits 403 — which would abort this target before the MCP
	@# Registry step below, the half CI does NOT do.
	@pkg=$$(node -p "require('./package.json').name"); \
	if npm view "$$pkg@$(VERSION)" version >/dev/null 2>&1; then \
	  echo "npm: $$pkg@$(VERSION) is already published — skipping (CI publishes on tag push)"; \
	else \
	  who=$$(npm whoami 2>/dev/null) && echo "npm: logged in as $$who" || { \
	    echo "npm: not logged in — starting 'npm login' (browser + security key)"; npm login; }; \
	  : "A PRE-RELEASE must not become 'latest' — bare `npm publish` ships an alpha to"; \
	  : "everyone on ^x.y.z. Same derivation as npm-publish.yml, which explains it in full."; \
	  tag=$$(echo "$(VERSION)" | grep -oE 'alpha|beta|rc' || echo latest); \
	  echo "npm: publishing $(VERSION) under dist-tag '$$tag'"; \
	  npm publish --access public --tag "$$tag"; \
	fi
	@echo ""
	@echo "── MCP Registry ──"
	@# npm-publish.yml publishes this on tag push too (ADR-105), so skip a version already
	@# there — same reasoning as the npm step above. `mcp-publisher login github` is a
	@# device flow needing a tty, so the skip also keeps this target runnable without one
	@# when the registry is already current.
	@name=$$(node -p "require('./server.json').name"); \
	published=$$(curl -fsSL "https://registry.modelcontextprotocol.io/v0/servers?search=$$name&limit=100" 2>/dev/null \
	  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.servers||[]).map(x=>x.version||(x.server&&x.server.version)).filter(Boolean).join(" "))}catch(e){console.log("")}})'); \
	if echo " $$published " | grep -q " $(VERSION) "; then \
	  echo "mcp: $$name $(VERSION) is already on the registry — skipping"; \
	else \
	  mcp-publisher login github && mcp-publisher publish server.json; \
	fi
	@echo ""
	@echo "── GitHub Release ──"
	@# RECONCILE, not create. The tag push already triggered release-mcpb.yml, which
	@# creates the release with --generate-notes and uploads the bundle — so a bare
	@# `gh release create` here fails "already exists" on EVERY release, and a red exit
	@# at the end of a publish trains you to ignore the exit code of a publish. Run this
	@# before CI finishes and the release is genuinely absent, so handle both.
	@#
	@# The bundle is named EXACTLY, never globbed. `google-workspace-mcp-*.mcpb` matched
	@# the per-platform bundles of the mcpb-all era, which this repo stopped producing but
	@# which still sit in working trees — and it does NOT match today's single output. On
	@# v4.2.0 that glob resolved to two THREE-POINT-OH bundles from a year earlier while
	@# omitting the one just built. Only the duplicate-release error stopped them shipping.
	@bundle=google-workspace-mcp.mcpb; \
	[ -f "$$bundle" ] || { echo "no $$bundle — run 'make mcpb'"; exit 1; }; \
	packed=$$(unzip -p "$$bundle" manifest.json 2>/dev/null | sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' | head -1); \
	if [ -z "$$packed" ]; then \
	  echo "warn: cannot read a version out of $$bundle (no unzip?) — staleness unchecked"; \
	elif [ "$$packed" != "$(VERSION)" ]; then \
	  echo "$$bundle holds v$$packed, but this is the v$(VERSION) publish."; \
	  echo "  Attaching it would ship the wrong code under this tag. Rebuild: make mcpb"; exit 1; \
	fi; \
	if [ -n "$(YES)$(NOTES)" ]; then notes="$(NOTES)"; \
	else read -p "Release notes (one line, or empty to keep the notes CI generated): " notes; fi; \
	if gh release view "v$(VERSION)" >/dev/null 2>&1; then \
	  echo "gh: v$(VERSION) already exists (CI creates it on tag push) — updating in place"; \
	  if [ -n "$$notes" ]; then gh release edit "v$(VERSION)" --notes "$$notes"; fi; \
	  gh release upload "v$(VERSION)" "$$bundle" --clobber; \
	elif [ -n "$$notes" ]; then \
	  gh release create "v$(VERSION)" --title "v$(VERSION)" --notes "$$notes" "$$bundle"; \
	else \
	  gh release create "v$(VERSION)" --title "v$(VERSION)" --generate-notes "$$bundle"; \
	fi
	@echo ""
	@echo "v$(VERSION) published to all channels."
