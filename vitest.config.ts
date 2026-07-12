import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Repo-wide, matching jest's old testMatch — a test added outside src/
    // must not be silently skipped.
    include: ['**/__tests__/**/*.test.ts'],
    // Keep vitest's defaults (node_modules, dist, ...) and add our build output,
    // which holds compiled copies of the tests themselves.
    exclude: [...configDefaults.exclude, 'build/**', 'mcpb/**'],
    // Replaces testSetup.ts's `beforeEach(() => jest.clearAllMocks())`
    clearMocks: true,
    // NOTE: file parallelism stays ON here. The integration suites hit live Google
    // APIs on one shared OAuth credential, so *they* must run serially — but they
    // are the only ones, and forcing the whole suite serial slows the mocked suite
    // CI actually runs. `npm run test:integration` passes --no-file-parallelism
    // instead.
  },
});
