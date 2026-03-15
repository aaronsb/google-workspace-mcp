.DEFAULT_GOAL := help
.PHONY: help test test-unit test-integration build clean typecheck

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

test: test-unit ## Run all tests (unit)

test-unit: ## Run unit tests (mocked, fast, no network)
	npx jest --config jest.config.cjs --testPathPattern='src/__tests__/(executor|accounts|server)' --runInBand

test-integration: ## Run integration tests (ACCOUNT=email optional)
	TEST_ACCOUNT=$(ACCOUNT) npx jest --config jest.config.cjs --testPathPattern='src/__tests__/integration' --runInBand

typecheck: ## Type-check without emitting
	npx tsc --noEmit --skipLibCheck

build: ## Compile TypeScript to build/
	npx tsc --skipLibCheck

clean: ## Remove build artifacts
	rm -rf build/
