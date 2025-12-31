import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for dashboard E2E tests.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.test.yaml up -d
 *
 * Run tests:
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './specs',
  // Run tests in sequence
  fullyParallel: false,
  // Fail the build on CI if test.only is left in source code
  forbidOnly: !!process.env.CI,
  // Retry failed tests on CI
  retries: process.env.CI ? 2 : 0,
  // Single worker for consistency
  workers: 1,
  // Reporter to use
  reporter: [['html', { open: 'never' }], ['list']],

  // Shared settings for all projects
  use: {
    // Base URL for navigation
    baseURL: process.env.DASHBOARD_URL || 'http://localhost:3001',
    // Collect trace when retrying failed test
    trace: 'on-first-retry',
    // Take screenshot on failure
    screenshot: 'only-on-failure',
    // Record video on failure
    video: 'on-first-retry',
    // Timeout for actions
    actionTimeout: 10000,
  },

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Can add more browsers as needed
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Output directory for test artifacts
  outputDir: 'test-results/',
});
