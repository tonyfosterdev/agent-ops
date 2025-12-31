import { test as base } from '@playwright/test';

/**
 * Test fixtures for dashboard E2E tests.
 *
 * Provides helpers for:
 * - Setting mock LLM fixtures
 * - Creating runs via API
 * - Waiting for run status changes
 */

type TestFixtures = {
  apiUrl: string;
  mockLlmUrl: string;
  setLLMFixture: (fixture: string) => Promise<void>;
  createRun: (prompt: string, agentType?: string) => Promise<string>;
  getRun: (runId: string) => Promise<{
    id: string;
    status: string;
    agentType: string;
    prompt: string;
  }>;
  waitForStatus: (runId: string, status: string, timeoutMs?: number) => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  apiUrl: async ({}, use) => {
    const url = process.env.API_URL || 'http://localhost:3210';
    await use(url);
  },

  mockLlmUrl: async ({}, use) => {
    const url = process.env.MOCK_LLM_URL || 'http://localhost:3333';
    await use(url);
  },

  setLLMFixture: async ({ mockLlmUrl }, use) => {
    const setFixture = async (fixture: string) => {
      const res = await fetch(`${mockLlmUrl}/fixtures/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture }),
      });
      if (!res.ok) {
        throw new Error(`Failed to set fixture: ${res.statusText}`);
      }
    };
    await use(setFixture);
  },

  createRun: async ({ apiUrl }, use) => {
    const create = async (prompt: string, agentType = 'orchestrator') => {
      const res = await fetch(`${apiUrl}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, agentType, user_id: 'test-user-playwright' }),
      });
      if (!res.ok) {
        throw new Error(`Failed to create run: ${res.statusText}`);
      }
      const { id } = await res.json();
      return id;
    };
    await use(create);
  },

  getRun: async ({ apiUrl }, use) => {
    const get = async (runId: string) => {
      const res = await fetch(`${apiUrl}/runs/${runId}`);
      if (!res.ok) {
        throw new Error(`Failed to get run: ${res.statusText}`);
      }
      return res.json();
    };
    await use(get);
  },

  waitForStatus: async ({ apiUrl }, use) => {
    const wait = async (runId: string, status: string, timeoutMs = 30000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const res = await fetch(`${apiUrl}/runs/${runId}`);
        const run = await res.json();
        if (run.status === status) {
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`Timeout waiting for status ${status}`);
    };
    await use(wait);
  },
});

export { expect } from '@playwright/test';
