.DEFAULT_GOAL := help
.PHONY: help test test-all test-unit test-integration build clean typecheck lint smoke check-gates \
        manifest-discover manifest-diff manifest-lint \
        coverage coverage-update \
        mcpb mcpb-all version-sync publish-all \
        release-patch release-minor release-major check

# Prerequisites in a target's list are only ordered when make runs serially. Under
# `make -j`, `smoke` could start while `build` was still mid-`tsc` (or inside its
# `rm -rf build/factory/manifest` window) and smoke-test the PREVIOUS build — a guard
# reporting on an artifact other than the one just produced. `version-stamp` rewrites
# src/version.ts, which a concurrent test run is reading. These targets are cheap;
# serialising them costs nothing and removes the class outright.
.NOTPARALLEL:

VERSION = $(shell node -p 'require("./package.json").version')
GWS_VERSION = $(shell node -p 'require("@googleworkspace/cli/package.json").version')

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

check-gates: ## Assert every test file is COLLECTED by some gate
	node scripts/check-test-gates.mjs

# Depends on build: smoking a stale build/ is exactly the "measured the wrong
# artifact" failure this whole branch is about.
smoke: build ## Start the built server on a foreign cwd and assert it loads its tools
	node scripts/smoke-start.mjs

# Mirrors CI. `lint` used to be in the help text but not the prerequisites, so a
# contributor could go green locally and red in CI on a job this target claimed
# to cover.
check: typecheck lint check-gates test build smoke ## Type-check, lint, test, build, smoke (CI gate)

clean: ## Remove build artifacts
	rm -rf build/ mcpb/server mcpb/bin *.mcpb

# --- Manifest management ---

manifest-discover: ## Discover all gws operations → discovered-manifest.yaml
	./scripts/gen-manifest.sh > discovered-manifest.yaml
	@echo "Wrote discovered-manifest.yaml ($$(grep -c 'type:' discovered-manifest.yaml) operations)"

manifest-diff: manifest-discover ## Diff discovered operations against curated manifest
	@echo "=== Operations in discovered but not in curated manifest ==="
	@node -e " \
		const fs = require('fs'), path = require('path'); \
		const dir = 'src/factory/manifest'; \
		let out = 'services:\n'; \
		for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()) { \
			out += '  ' + path.basename(f, '.yaml') + ':\n'; \
			out += fs.readFileSync(path.join(dir, f), 'utf-8') \
				.split('\n').map(l => l === '' ? '' : '    ' + l).join('\n'); \
			if (!out.endsWith('\n')) out += '\n'; \
		} \
		fs.writeFileSync('/tmp/gws-curated-manifest-reassembled.yaml', out); \
	"
	@diff --color=auto -u /tmp/gws-curated-manifest-reassembled.yaml discovered-manifest.yaml || true

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

coverage: build ## Analyze gws CLI coverage vs curated manifest
	node build/coverage/analyze.js

coverage-update: build ## Update coverage baseline from current gws surface
	node build/coverage/analyze.js --update

# --- MCPB packaging ---

mcpb: build ## Build .mcpb for current platform (PLATFORM=linux-x64 etc.)
	$(eval PLATFORM ?= $(shell node -e "const os=require('os'); const a=os.arch()==='arm64'?'arm64':'x64'; const p=os.platform()==='darwin'?'darwin':os.platform()==='win32'?'windows':'linux'; console.log(p+'-'+a)"))
	@echo "Building mcpb v$(VERSION) with gws $(GWS_VERSION) for $(PLATFORM)"
	rm -rf mcpb/server mcpb/bin
	mkdir -p mcpb/server
	cp -r build/* mcpb/server/
	cp package.json mcpb/server/package.json
	cd mcpb/server && npm install --production --ignore-scripts --silent
	rm -f mcpb/server/package.json mcpb/server/package-lock.json
	./scripts/download-gws-binary.sh $(PLATFORM) $(GWS_VERSION)
	mcpb pack mcpb google-workspace-mcp-$(PLATFORM).mcpb
	node scripts/verify-mcpb.cjs google-workspace-mcp-$(PLATFORM).mcpb
	@echo ""
	@echo "Built: google-workspace-mcp-$(PLATFORM).mcpb ($$(du -h google-workspace-mcp-$(PLATFORM).mcpb | cut -f1))"

mcpb-all: build ## Build .mcpb for all platforms
	@for plat in darwin-arm64 darwin-x64 linux-arm64 linux-x64 windows-x64; do \
		echo ""; \
		echo "=== $$plat ==="; \
		$(MAKE) mcpb PLATFORM=$$plat; \
	done
	@echo ""
	@echo "All platform bundles built:"
	@ls -lh google-workspace-mcp-*.mcpb 2>/dev/null

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
	@echo "Released v$(NEW_VERSION). Run 'make publish-all' to publish everywhere."

# --- Publishing ---

publish-all: mcpb-all ## Publish to npm, MCP Registry, GitHub Release
	@echo ""
	@echo "Publishing v$(VERSION) to all channels."
	@echo "  1. npm (requires OTP)"
	@echo "  2. MCP Registry (requires GitHub auth)"
	@echo "  3. GitHub Release (with all .mcpb bundles)"
	@echo ""
	@read -p "Continue? [y/N] " confirm && [ "$$confirm" = "y" ] || (echo "Aborted." && exit 1)
	@echo ""
	@echo "── npm ──"
	@read -p "npm OTP: " otp && npm publish --access public --otp "$$otp"
	@echo ""
	@echo "── MCP Registry ──"
	mcp-publisher login github
	mcp-publisher publish server.json
	@echo ""
	@echo "── GitHub Release ──"
	@read -p "Release notes (one line, or empty for default): " notes; \
	if [ -z "$$notes" ]; then notes="Release v$(VERSION)"; fi; \
	gh release create "v$(VERSION)" --title "v$(VERSION)" --notes "$$notes" google-workspace-mcp-*.mcpb
	@echo ""
	@echo "v$(VERSION) published to all channels."
