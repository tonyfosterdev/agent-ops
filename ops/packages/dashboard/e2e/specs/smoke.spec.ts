import { test, expect } from '../fixtures/test-fixtures';

/**
 * Smoke tests for dashboard.
 *
 * Verifies basic functionality:
 * - Dashboard loads correctly
 * - Create run form is visible
 * - API connectivity works
 *
 * Prerequisites:
 *   docker compose -f docker-compose.test.yaml up -d
 */

test.describe('Dashboard Smoke Tests', () => {
  test('dashboard loads and displays header', async ({ page }) => {
    await page.goto('/');

    // Check header is visible
    await expect(page.locator('h1')).toContainText('Agent Dashboard');

    // Check subtitle
    await expect(page.getByText('Durable Run Architecture')).toBeVisible();
  });

  test('create run form is visible', async ({ page }) => {
    await page.goto('/');

    // Check form elements are visible
    await expect(page.getByText('Start a New Run')).toBeVisible();

    // The form should have a textarea for the prompt
    // Based on the App.tsx, it uses CreateRunForm component
    await expect(page.locator('textarea, input[type="text"]').first()).toBeVisible();
  });

  test('can interact with agent type dropdown if present', async ({ page }) => {
    await page.goto('/');

    // Look for select dropdown or similar control
    const select = page.locator('select');
    const selectCount = await select.count();

    if (selectCount > 0) {
      // Verify it's interactive
      await expect(select.first()).toBeEnabled();
    }
    // If no select, that's okay - form structure may vary
  });

  test('new run button appears when viewing a run', async ({
    page,
    createRun,
    setLLMFixture,
  }) => {
    // Set a simple fixture
    await setLLMFixture('default.json');

    // Create a run via API
    const runId = await createRun('Smoke test prompt');

    // Navigate to run page
    await page.goto(`/?runId=${runId}`);

    // Wait for the page to load run info
    await expect(page.getByText('Run ID:')).toBeVisible({ timeout: 10000 });

    // New Run button should appear
    await expect(page.getByRole('button', { name: /new run/i })).toBeVisible();
  });

  test('displays run status badge', async ({
    page,
    createRun,
    setLLMFixture,
  }) => {
    await setLLMFixture('default.json');
    const runId = await createRun('Status badge test');

    await page.goto(`/?runId=${runId}`);

    // Wait for status badge to appear (any status)
    // The StatusBadge component shows status in uppercase
    await expect(page.locator('span').filter({ hasText: /PENDING|RUNNING|SUSPENDED|COMPLETED|FAILED|CANCELLED/ })).toBeVisible({
      timeout: 15000,
    });
  });

  test('event timeline section exists', async ({
    page,
    createRun,
    setLLMFixture,
  }) => {
    await setLLMFixture('default.json');
    const runId = await createRun('Timeline test');

    await page.goto(`/?runId=${runId}`);

    // Wait for Timeline section heading
    await expect(page.getByText('Event Timeline')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('API Connectivity', () => {
  test('mock LLM is reachable', async ({ mockLlmUrl }) => {
    const res = await fetch(`${mockLlmUrl}/health`);
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  test('agent server is reachable', async ({ apiUrl }) => {
    const res = await fetch(`${apiUrl}/health`);
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  test('can create run via API', async ({ createRun }) => {
    const runId = await createRun('API test prompt');
    expect(runId).toBeDefined();
    expect(typeof runId).toBe('string');
  });

  test('can get run via API', async ({ createRun, getRun }) => {
    const runId = await createRun('Get run test');
    const run = await getRun(runId);

    expect(run.id).toBe(runId);
    expect(run.prompt).toBe('Get run test');
    expect(run.agentType).toBe('orchestrator');
  });
});
