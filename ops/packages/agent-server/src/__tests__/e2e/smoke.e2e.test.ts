/**
 * Smoke E2E Tests
 *
 * Basic tests to verify the test infrastructure is working:
 * - Services are reachable
 * - Basic API operations work
 * - Mock LLM responds correctly
 *
 * Prerequisites:
 *   docker compose -f docker-compose.test.yaml up -d
 */

import {
  TEST_CONFIG,
  waitForService,
  setLLMFixture,
  clearLLMQueue,
  createTestRun,
  getRun,
  getRunEvents,
  isTestEnvRunning,
} from './setup';

describe('Smoke E2E Tests', () => {
  // Check if test environment is running before all tests
  beforeAll(async () => {
    const isRunning = await isTestEnvRunning();
    if (!isRunning) {
      throw new Error(
        'Test environment is not running. Start it with: docker compose -f docker-compose.test.yaml up -d'
      );
    }
  }, 10000);

  // Reset LLM fixture state after each test to prevent cross-test contamination
  afterEach(async () => {
    await clearLLMQueue();
    await setLLMFixture('default.json');
  });

  describe('Service Health Checks', () => {
    it('agent-server is healthy', async () => {
      const res = await fetch(`${TEST_CONFIG.apiUrl}/health`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('agent-server');
    });

    it('mock-llm is healthy', async () => {
      const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/health`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('mock-llm');
    });

    it('mock-llm has fixtures available', async () => {
      const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/fixtures`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(Array.isArray(data.fixtures)).toBe(true);
      expect(data.fixtures).toContain('default.json');
      expect(data.fixtures).toContain('dangerous-shell.json');
    });
  });

  describe('Mock LLM Fixture Control', () => {
    it('can set active fixture', async () => {
      await setLLMFixture('dangerous-shell.json');

      const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/fixtures`);
      const data = await res.json();
      expect(data.active).toBe('dangerous-shell.json');

      // Reset to default
      await setLLMFixture('default.json');
    });

    it('returns fixture content via Anthropic API', async () => {
      await setLLMFixture('default.json');

      const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.type).toBe('message');
      expect(data.role).toBe('assistant');
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content[0].type).toBe('text');
    });

    it('returns tool_use fixture correctly', async () => {
      await setLLMFixture('dangerous-shell.json');

      const res = await fetch(`${TEST_CONFIG.mockLlmUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-3-opus-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'Run ls' }],
        }),
      });

      expect(res.ok).toBe(true);

      const data = await res.json();
      expect(data.stop_reason).toBe('tool_use');

      // Find tool_use content block
      const toolUse = data.content.find(
        (c: { type: string }) => c.type === 'tool_use'
      );
      expect(toolUse).toBeDefined();
      expect(toolUse.name).toBe('shell_command_execute');
      expect(toolUse.input).toHaveProperty('command');

      // Reset
      await setLLMFixture('default.json');
    });
  });

  describe('Run API', () => {
    it('creates a run and returns an ID', async () => {
      const runId = await createTestRun('Test prompt for smoke test');

      expect(runId).toBeDefined();
      expect(typeof runId).toBe('string');
      expect(runId.length).toBeGreaterThan(0);

      // Verify run exists
      const run = await getRun(runId);
      expect(run.id).toBe(runId);
      expect(run.prompt).toBe('Test prompt for smoke test');
    });

    it('gets run details', async () => {
      const runId = await createTestRun('Another test prompt');
      const run = await getRun(runId);

      expect(run).toHaveProperty('id');
      expect(run).toHaveProperty('status');
      expect(run).toHaveProperty('agent_type');
      expect(run).toHaveProperty('created_at');
    });

    it('gets run events from run details', async () => {
      const runId = await createTestRun('Event test prompt');

      // Give it a moment for initial events
      await new Promise((r) => setTimeout(r, 500));

      // Events are embedded in run response
      const run = await getRun(runId);
      const events = run.events || [];

      expect(Array.isArray(events)).toBe(true);
      // Should have at least RUN_STARTED event
      if (events.length > 0) {
        expect(events[0]).toHaveProperty('type');
        expect(events[0]).toHaveProperty('created_at');
      }
    });

    it('lists all runs', async () => {
      // Create a run first
      await createTestRun('List test prompt');

      const res = await fetch(`${TEST_CONFIG.apiUrl}/runs`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      // API returns { runs: [...], total, limit, offset }
      expect(data).toHaveProperty('runs');
      expect(Array.isArray(data.runs)).toBe(true);
      expect(data.runs.length).toBeGreaterThan(0);
    });
  });
});
