/**
 * E2E Test Setup and Configuration
 *
 * Provides utilities for running E2E tests against the test docker-compose environment.
 * Tests expect the test environment to be running (docker-compose.test.yaml).
 */

export const TEST_CONFIG = {
  apiUrl: process.env.TEST_API_URL || 'http://localhost:3210',
  mockLlmUrl: process.env.MOCK_LLM_URL || 'http://localhost:3333',
  inngestUrl: process.env.INNGEST_URL || 'http://localhost:8288',
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:3001',
};

/**
 * Wait for a service to become available
 */
export async function waitForService(
  url: string,
  maxAttempts = 30,
  intervalMs = 1000
): Promise<void> {
  const healthUrl = `${url}/health`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        console.log(`Service at ${url} is ready (attempt ${attempt})`);
        return;
      }
    } catch {
      // Service not ready yet
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `Service at ${url} not available after ${maxAttempts} attempts`
  );
}

/**
 * Set the LLM fixture for subsequent mock LLM responses
 */
export async function setLLMFixture(fixture: string): Promise<void> {
  const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/fixtures/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fixture }),
  });

  if (!res.ok) {
    throw new Error(`Failed to set LLM fixture: ${res.statusText}`);
  }
}

/**
 * Queue multiple LLM fixtures to return in sequence
 */
export async function queueLLMFixtures(fixtures: string[]): Promise<void> {
  const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/fixtures/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fixtures }),
  });

  if (!res.ok) {
    throw new Error(`Failed to queue LLM fixtures: ${res.statusText}`);
  }
}

/**
 * Clear the LLM fixture queue
 */
export async function clearLLMQueue(): Promise<void> {
  const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/fixtures/clear`, {
    method: 'POST',
  });

  if (!res.ok) {
    throw new Error(`Failed to clear LLM queue: ${res.statusText}`);
  }
}

/**
 * Create a new test run
 */
export async function createTestRun(
  prompt: string,
  agentType = 'orchestrator',
  userId = 'test-user-e2e'
): Promise<string> {
  const res = await fetch(`${TEST_CONFIG.apiUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, agentType, user_id: userId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create run: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Get run details
 */
export async function getRun(runId: string): Promise<{
  id: string;
  status: string;
  agent_type: string;
  prompt: string;
  created_at: string;
  updated_at: string;
  events?: Array<{
    id: string;
    type: string;
    payload: unknown;
    created_at: string;
  }>;
}> {
  const res = await fetch(`${TEST_CONFIG.apiUrl}/runs/${runId}`);

  if (!res.ok) {
    throw new Error(`Failed to get run: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Get run events
 */
export async function getRunEvents(runId: string): Promise<
  Array<{
    id: string;
    event_type: string;
    payload: unknown;
    created_at: string;
  }>
> {
  const res = await fetch(`${TEST_CONFIG.apiUrl}/runs/${runId}/events`);

  if (!res.ok) {
    throw new Error(`Failed to get run events: ${res.statusText}`);
  }

  return res.json();
}

/**
 * Wait for a run to reach a specific status
 */
export async function waitForRunStatus(
  runId: string,
  status: string | string[],
  timeoutMs = 30000
): Promise<{
  id: string;
  status: string;
  agent_type: string;
  prompt: string;
}> {
  const statuses = Array.isArray(status) ? status : [status];
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const run = await getRun(runId);

    if (statuses.includes(run.status)) {
      return run;
    }

    // Check for terminal error states
    if (run.status === 'failed' && !statuses.includes('failed')) {
      throw new Error(`Run ${runId} failed unexpectedly`);
    }

    await sleep(500);
  }

  const run = await getRun(runId);
  throw new Error(
    `Run ${runId} did not reach status ${statuses.join('|')} within ${timeoutMs}ms (current: ${run.status})`
  );
}

/**
 * Resume a suspended run
 */
export async function resumeRun(
  runId: string,
  decision: 'approved' | 'rejected',
  feedback = ''
): Promise<void> {
  const res = await fetch(`${TEST_CONFIG.apiUrl}/runs/${runId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, feedback }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to resume run: ${res.status} ${text}`);
  }
}

/**
 * Cancel a run
 */
export async function cancelRun(runId: string): Promise<void> {
  const res = await fetch(`${TEST_CONFIG.apiUrl}/runs/${runId}/cancel`, {
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to cancel run: ${res.status} ${text}`);
  }
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if test environment is running
 */
export async function isTestEnvRunning(): Promise<boolean> {
  try {
    const [apiRes, mockLlmRes] = await Promise.all([
      fetch(`${TEST_CONFIG.apiUrl}/health`).catch(() => null),
      fetch(`${TEST_CONFIG.mockLlmUrl}/health`).catch(() => null),
    ]);

    return apiRes?.ok === true && mockLlmRes?.ok === true;
  } catch {
    return false;
  }
}
