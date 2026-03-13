.PHONY: test test-unit test-integration build clean typecheck

# Unit tests — mocked, fast, no network
test-unit:
	npx jest --config jest.config.cjs --testPathPattern='src/__tests__/(executor|accounts)' --runInBand

# Integration tests — requires gws installed + valid credentials
test-integration:
	npx jest --config jest.config.cjs --testPathPattern='src/__tests__/integration' --runInBand

# All unit tests
test: test-unit

# Type checking
typecheck:
	npx tsc --noEmit --skipLibCheck

# Build
build:
	npx tsc --skipLibCheck

# Clean build output
clean:
	rm -rf build/
