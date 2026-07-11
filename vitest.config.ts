import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Repo-wide, matching Jest's old testMatch — a test added outside src/
    // must not be silently skipped.
    include: ['**/__tests__/**/*.test.ts'],
    // Keep vitest's defaults (node_modules, dist, ...) and add our build output,
    // which holds compiled copies of the tests themselves.
    exclude: [...configDefaults.exclude, 'build/**', 'mcpb/**'],
    // Mirrors jest's --runInBand. The integration suites shell out to the real
    // gws binary against live Google APIs using one shared OAuth credential;
    // running their files in parallel races the token refresh and trips rate limits.
    fileParallelism: false,
    // Replaces testSetup.ts's `beforeEach(() => jest.clearAllMocks())`
    clearMocks: true,
  },
});
