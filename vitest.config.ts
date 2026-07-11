import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Build output contains compiled copies of the tests and their manual mocks.
    exclude: ['**/node_modules/**', 'build/**', 'mcpb/**'],
    // Replaces testSetup.ts's `beforeEach(() => jest.clearAllMocks())`
    clearMocks: true,
  },
});
