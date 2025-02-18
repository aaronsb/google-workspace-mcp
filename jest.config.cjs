/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@modelcontextprotocol/sdk/(.*)$': '<rootDir>/src/__mocks__/@modelcontextprotocol/sdk.ts',
    '^@modelcontextprotocol/sdk$': '<rootDir>/src/__mocks__/@modelcontextprotocol/sdk.ts',
    '^src/utils/logger.js$': '<rootDir>/src/__mocks__/logger.ts',
    '^../utils/logger.js$': '<rootDir>/src/__mocks__/logger.ts',
    '^../../utils/logger.js$': '<rootDir>/src/__mocks__/logger.ts'
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.json'
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(googleapis|google-auth-library|@modelcontextprotocol/sdk|zod)/)'
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__helpers__/testSetup.ts'],
  reporters: [
    'default',
    '<rootDir>/src/__helpers__/customReporter.ts'
  ]
};
