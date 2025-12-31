/** @type {import('jest').Config} */
module.exports = {
  displayName: 'e2e',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
  // Longer timeout for E2E tests (30 seconds default, can be overridden per-test)
  testTimeout: 30000,
  // Run tests serially to avoid race conditions
  maxWorkers: 1,
  // Verbose output for E2E
  verbose: true,
  // Clear mocks between tests
  clearMocks: true,
  // Global setup/teardown could be added here if needed
  // globalSetup: '<rootDir>/src/__tests__/e2e/global-setup.ts',
  // globalTeardown: '<rootDir>/src/__tests__/e2e/global-teardown.ts',
};
