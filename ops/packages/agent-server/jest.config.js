/** @type {import('jest').Config} */
module.exports = {
  displayName: 'unit',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Match test files, excluding e2e tests (which use .e2e.test.ts suffix)
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  // Explicitly exclude e2e tests from unit test runs
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.e2e\\.test\\.ts$'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        // Suppress warning about Node16/18/Next module mode
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
  // Clear mocks automatically between tests
  clearMocks: true,
  // Collect coverage from src directory
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/__tests__/**'],
  // Module name mapper for path aliases if needed
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
