.DEFAULT_GOAL := help
.PHONY: help test test-all test-unit test-integration build clean typecheck \
        manifest-discover manifest-diff manifest-lint

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

test: test-unit ## Run unit tests (default)

test-all: test-unit test-integration ## Run unit + integration tests

test-unit: ## Run unit tests (mocked, fast, no network)
	npx jest --config jest.config.cjs --testPathPattern='src/__tests__/(executor|accounts|server)' --runInBand

test-integration: ## Run integration tests (ACCOUNT=email optional)
	$(if $(ACCOUNT),TEST_ACCOUNT=$(ACCOUNT)) npx jest --config jest.config.cjs --testPathPattern='src/__tests__/integration' --runInBand

typecheck: ## Type-check without emitting
	npx tsc --noEmit --skipLibCheck

build: ## Compile TypeScript to build/
	npx tsc --skipLibCheck

clean: ## Remove build artifacts
	rm -rf build/

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
