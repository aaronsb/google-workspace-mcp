.DEFAULT_GOAL := help
.PHONY: help test test-all test-unit test-integration build clean typecheck \
        manifest-discover manifest-diff manifest-lint \
        mcpb mcpb-all version-sync publish-all \
        release-patch release-minor release-major check

VERSION = $(shell node -p 'require("./package.json").version')
GWS_VERSION = $(shell node -p 'require("@googleworkspace/cli/package.json").version')

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# --- Build & Test ---

test: test-unit ## Run unit tests (default)

test-all: test-unit test-integration ## Run unit + integration tests

test-unit: ## Run unit tests (mocked, fast, no network)
	npx jest --config jest.config.cjs --testPathPattern='src/__tests__/(executor|accounts|server|factory)' --runInBand

test-integration: ## Run integration tests (ACCOUNT=email optional)
	$(if $(ACCOUNT),TEST_ACCOUNT=$(ACCOUNT)) npx jest --config jest.config.cjs --testPathPattern='src/__tests__/integration' --runInBand

typecheck: ## Type-check without emitting
	npx tsc --noEmit --skipLibCheck

build: ## Compile TypeScript to build/
	npx tsc --skipLibCheck && cp src/factory/manifest.yaml build/factory/

check: typecheck test build ## Lint, test, and build (CI gate)

clean: ## Remove build artifacts
	rm -rf build/ mcpb/server mcpb/bin *.mcpb

# --- Manifest management ---

manifest-discover: ## Discover all gws operations → discovered-manifest.yaml
	./scripts/gen-manifest.sh > discovered-manifest.yaml
	@echo "Wrote discovered-manifest.yaml ($$(grep -c 'type:' discovered-manifest.yaml) operations)"

manifest-diff: manifest-discover ## Diff discovered operations against curated manifest
	@echo "=== Operations in discovered but not in curated manifest ==="
	@diff --color=auto -u src/factory/manifest.yaml discovered-manifest.yaml || true

manifest-lint: ## Validate manifest YAML syntax and structure
	@node -e " \
		const fs = require('fs'); \
		const yaml = require('yaml'); \
		const m = yaml.parse(fs.readFileSync('src/factory/manifest.yaml', 'utf-8')); \
		let ops = 0; \
		for (const [svc, def] of Object.entries(m.services)) { \
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
		console.log('  Total: ' + ops + ' operations across ' + Object.keys(m.services).length + ' services'); \
	"

# --- MCPB packaging ---

mcpb: build ## Build .mcpb for current platform (PLATFORM=linux-x64 etc.)
	$(eval PLATFORM ?= $(shell node -e "const os=require('os'); const a=os.arch()==='arm64'?'arm64':'x64'; const p=os.platform()==='darwin'?'darwin':os.platform()==='win32'?'windows':'linux'; console.log(p+'-'+a)"))
	@echo "Building mcpb v$(VERSION) with gws $(GWS_VERSION) for $(PLATFORM)"
	rm -rf mcpb/server mcpb/bin
	mkdir -p mcpb/server
	cp -r build/* mcpb/server/
	cp src/factory/manifest.yaml mcpb/server/factory/
	cp package.json mcpb/server/package.json
	cd mcpb/server && npm install --production --ignore-scripts --silent
	rm -f mcpb/server/package.json mcpb/server/package-lock.json
	./scripts/download-gws-binary.sh $(PLATFORM) $(GWS_VERSION)
	mcpb pack mcpb google-workspace-mcp-$(PLATFORM).mcpb
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
	git add package.json package-lock.json server.json mcpb/manifest.json
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
