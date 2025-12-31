# Testing Strategy

> **Version**: 1.1
> **Phase**: 1.5 (Testing Infrastructure)
> **Status**: Implemented

---

## Quick Start

```bash
# Start test environment (from repo root)
docker compose -f docker-compose.test.yaml up -d --wait

# Run backend E2E tests (from ops/packages/agent-server)
cd ops/packages/agent-server
npm run test:e2e

# Run Playwright tests (from ops/packages/dashboard)
cd ops/packages/dashboard
npx playwright install chromium  # First time only
npm run test:e2e

# Stop test environment
docker compose -f docker-compose.test.yaml down
```

### Test Commands Reference

| Package | Command | Description |
|---------|---------|-------------|
| agent-server | `npm test` | Run unit tests |
| agent-server | `npm run test:e2e` | Run backend E2E tests |
| agent-server | `npm run test:e2e:setup` | Start test containers |
| agent-server | `npm run test:e2e:teardown` | Stop test containers |
| dashboard | `npm run test:e2e` | Run Playwright tests (headless) |
| dashboard | `npm run test:e2e:headed` | Run Playwright tests (visible browser) |
| dashboard | `npm run test:e2e:ui` | Open Playwright UI mode |

---

## Overview

This document defines the comprehensive testing strategy for the Agent Server, covering unit tests, backend E2E tests, and browser E2E tests with Playwright.

### Test Pyramid

```
                    ▲
                   /┃\        Playwright (Browser E2E)
                  / ┃ \       - Dashboard UI flows
                 /  ┃  \      - HITL approval via browser
                /   ┃   \     - Real-time updates
               /────┃────\
              /     ┃     \   Jest (Backend E2E)
             /      ┃      \  - Full API flows
            /       ┃       \ - HITL suspension/resume
           /        ┃        \- Server restart recovery
          /─────────┃─────────\
         /          ┃          \  Jest (Integration)
        /           ┃           \ - HITL flow logic
       /            ┃            \- Journal writes
      /─────────────┃─────────────\
     /              ┃              \  Jest (Unit)
    /               ┃               \ - Utilities
   /                ┃                \- Pure functions
  /──────────────────────────────────\
```

### Test Layers Summary

| Layer | Technology | Scope | LLM | Database | Inngest |
|-------|------------|-------|-----|----------|---------|
| **Unit** | Jest | Pure functions | Mocked | Mocked | Mocked |
| **Integration** | Jest | Service logic | Mocked | Mocked | Mocked |
| **Backend E2E** | Jest + Supertest | Full API | Mock Server | Real (test) | Real (dev server) |
| **Browser E2E** | Playwright | Dashboard UI | Mock Server | Real (test) | Real (dev server) |

---

## Part 1: Test Infrastructure

### 1.1 Directory Structure

```
ops/packages/agent-server/
├── src/
│   ├── __tests__/
│   │   ├── e2e/                      # Backend E2E tests
│   │   │   ├── setup.ts              # E2E test setup
│   │   │   ├── helpers.ts            # Shared test utilities
│   │   │   ├── runs.e2e.test.ts      # Run lifecycle tests
│   │   │   ├── hitl.e2e.test.ts      # HITL flow tests
│   │   │   └── recovery.e2e.test.ts  # Crash recovery tests
│   │   └── fixtures/                 # Test data fixtures
│   │       ├── llm-responses/        # Mock LLM response fixtures
│   │       │   ├── safe-tool.json
│   │       │   ├── dangerous-tool.json
│   │       │   └── multi-step.json
│   │       └── runs/                 # Pre-configured run states
│   └── inngest/functions/__tests__/  # Inngest function unit tests
│       └── agentRun.hitl.test.ts     # HITL unit tests (existing)
├── e2e/                              # Playwright browser tests (separate)
│   ├── playwright.config.ts
│   ├── setup/
│   │   └── global-setup.ts
│   ├── fixtures/
│   │   └── test-fixtures.ts
│   └── specs/
│       ├── create-run.spec.ts
│       ├── approval-flow.spec.ts
│       ├── rejection-flow.spec.ts
│       ├── cancel-run.spec.ts
│       └── real-time-updates.spec.ts
└── jest.config.js

ops/packages/mock-llm/               # Mock LLM Server (new package)
├── src/
│   ├── server.ts                    # Hono HTTP server
│   ├── fixtures.ts                  # Fixture loader
│   └── handlers/
│       └── chat-completions.ts      # OpenAI-compatible endpoint
├── fixtures/
│   ├── default.json
│   ├── dangerous-shell.json
│   ├── safe-read-file.json
│   └── multi-tool.json
├── package.json
└── Dockerfile

ops/packages/dashboard/
└── e2e/                             # Dashboard Playwright tests
    ├── playwright.config.ts
    └── specs/
        ├── approval-flow.spec.ts
        └── real-time-sync.spec.ts
```

### 1.2 Docker Compose Test Environment

**`docker-compose.test.yaml`**:
```yaml
version: '3.8'

services:
  # Mock LLM Server - deterministic responses
  mock-llm:
    build: ./ops/packages/mock-llm
    ports:
      - "3333:3333"
    environment:
      - FIXTURE_DIR=/fixtures
      - DEFAULT_FIXTURE=default.json
    volumes:
      - ./ops/packages/mock-llm/fixtures:/fixtures:ro
    networks:
      - test-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3333/health"]
      interval: 5s
      timeout: 5s
      retries: 3

  # Inngest Dev Server for testing
  inngest-test:
    image: inngest/inngest:latest
    command: 'inngest dev -u http://agent-server-test:3200/api/inngest --no-discovery --no-poll'
    ports:
      - "8288:8288"
    networks:
      - test-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8288/health"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Test Database
  agent-db-test:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: testuser
      POSTGRES_PASSWORD: testpass
      POSTGRES_DB: agent_test_db
    ports:
      - "5433:5432"
    networks:
      - test-network
    tmpfs:
      - /var/lib/postgresql/data  # In-memory for speed
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U testuser -d agent_test_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  # Agent Server in test mode
  # NOTE: Uses port 3210 externally to avoid conflict with main stack on 3200
  agent-server-test:
    build:
      context: .
      dockerfile: ops/packages/agent-server/Dockerfile
    environment:
      - NODE_ENV=test
      - USE_INNGEST=true
      - INNGEST_DEV=1
      - INNGEST_BASE_URL=http://inngest-test:8288
      - DATABASE_URL=postgresql://testuser:testpass@agent-db-test:5432/agent_test_db
      - ANTHROPIC_API_BASE=http://mock-llm:3333
      - ANTHROPIC_API_KEY=test-key-not-used
    ports:
      - "3210:3200"  # External 3210 -> Internal 3200
    depends_on:
      mock-llm:
        condition: service_healthy
      inngest-test:
        condition: service_healthy
      agent-db-test:
        condition: service_healthy
    networks:
      - test-network

  # Dashboard for Playwright tests
  dashboard-test:
    build:
      context: .
      dockerfile: ops/packages/dashboard/Dockerfile
    environment:
      - VITE_API_URL=http://agent-server-test:3200
    ports:
      - "3001:3001"
    depends_on:
      - agent-server-test
    networks:
      - test-network

networks:
  test-network:
    driver: bridge
```

### 1.3 Mock LLM Server

The Mock LLM Server provides deterministic responses for reproducible tests.

**`ops/packages/mock-llm/src/server.ts`**:
```typescript
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadFixture, setActiveFixture } from './fixtures';

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Set fixture for next request(s)
app.post('/fixtures/set', async (c) => {
  const { fixture } = await c.req.json();
  setActiveFixture(fixture);
  return c.json({ success: true, fixture });
});

// OpenAI-compatible chat completions
app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json();
  const fixture = loadFixture();

  // Return fixture response
  return c.json({
    id: `chatcmpl-test-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'mock-model',
    choices: [{
      index: 0,
      message: fixture.message,
      finish_reason: fixture.finish_reason || 'stop',
    }],
    usage: fixture.usage || { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
});

// Anthropic-compatible messages API
app.post('/v1/messages', async (c) => {
  const body = await c.req.json();
  const fixture = loadFixture();

  return c.json({
    id: `msg-test-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: fixture.content,
    model: body.model || 'mock-model',
    stop_reason: fixture.stop_reason || 'end_turn',
    usage: fixture.usage || { input_tokens: 100, output_tokens: 50 },
  });
});

const port = parseInt(process.env.PORT || '3333');
console.log(`Mock LLM Server starting on port ${port}`);
serve({ fetch: app.fetch, port });
```

**Example Fixture (`fixtures/dangerous-shell.json`)**:
```json
{
  "content": [
    {
      "type": "text",
      "text": "I need to execute a shell command to list the files."
    },
    {
      "type": "tool_use",
      "id": "call-dangerous-1",
      "name": "shell_command_execute",
      "input": {
        "command": "ls -la"
      }
    }
  ],
  "stop_reason": "tool_use",
  "usage": {
    "input_tokens": 150,
    "output_tokens": 75
  }
}
```

---

## Part 2: Backend E2E Tests

### 2.1 Test Setup

**`src/__tests__/e2e/setup.ts`**:
```typescript
import { beforeAll, afterAll, beforeEach } from '@jest/globals';

export const TEST_CONFIG = {
  // NOTE: Port 3210 to avoid conflict with main stack on 3200
  apiUrl: process.env.TEST_API_URL || 'http://localhost:3210',
  mockLlmUrl: process.env.MOCK_LLM_URL || 'http://localhost:3333',
  inngestUrl: process.env.INNGEST_URL || 'http://localhost:8288',
};

export async function waitForService(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch (e) {
      // Service not ready
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Service at ${url} not available after ${maxAttempts} attempts`);
}

export async function setLLMFixture(fixture: string): Promise<void> {
  await fetch(`${TEST_CONFIG.mockLlmUrl}/fixtures/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fixture }),
  });
}

export async function waitForRunStatus(
  runId: string,
  status: string,
  timeoutMs = 30000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}`);
    const run = await res.json();
    if (run.status === status) return run;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Run ${runId} did not reach status ${status} within ${timeoutMs}ms`);
}

export async function createTestRun(prompt: string, agentType = 'orchestrator'): Promise<string> {
  const res = await fetch(`${TEST_CONFIG.apiUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, agentType }),
  });
  const { id } = await res.json();
  return id;
}
```

### 2.2 Run Lifecycle Tests

**`src/__tests__/e2e/runs.e2e.test.ts`**:
```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  waitForService,
  setLLMFixture,
  createTestRun,
  waitForRunStatus,
  TEST_CONFIG
} from './setup';

describe('Run Lifecycle E2E', () => {
  beforeAll(async () => {
    await waitForService(TEST_CONFIG.apiUrl);
    await waitForService(TEST_CONFIG.mockLlmUrl);
  }, 60000);

  it('creates a run and completes with safe tools', async () => {
    // Set LLM to return safe tool (read_file)
    await setLLMFixture('safe-read-file.json');

    // Create run
    const runId = await createTestRun('Read the README file');

    // Wait for completion
    const run = await waitForRunStatus(runId, 'completed', 30000);

    // Verify
    expect(run.status).toBe('completed');

    // Check events
    const eventsRes = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/events`);
    const events = await eventsRes.json();

    expect(events).toContainEqual(
      expect.objectContaining({ event_type: 'RUN_STARTED' })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event_type: 'RUN_COMPLETED' })
    );
  }, 60000);

  it('fails run when LLM returns error', async () => {
    await setLLMFixture('llm-error.json');

    const runId = await createTestRun('This will fail');
    const run = await waitForRunStatus(runId, 'failed', 30000);

    expect(run.status).toBe('failed');
  }, 60000);
});
```

### 2.3 HITL Flow Tests

**`src/__tests__/e2e/hitl.e2e.test.ts`**:
```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  waitForService,
  setLLMFixture,
  createTestRun,
  waitForRunStatus,
  TEST_CONFIG
} from './setup';

describe('HITL Flow E2E', () => {
  beforeAll(async () => {
    await waitForService(TEST_CONFIG.apiUrl);
    await waitForService(TEST_CONFIG.mockLlmUrl);
    await waitForService(TEST_CONFIG.inngestUrl);
  }, 60000);

  it('suspends on dangerous tool and resumes on approval', async () => {
    // Set LLM to return dangerous tool
    await setLLMFixture('dangerous-shell.json');

    // Create run
    const runId = await createTestRun('Execute ls command');

    // Wait for suspension
    const suspendedRun = await waitForRunStatus(runId, 'suspended', 30000);
    expect(suspendedRun.status).toBe('suspended');

    // Check suspension event
    const eventsRes = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/events`);
    const events = await eventsRes.json();
    expect(events).toContainEqual(
      expect.objectContaining({ event_type: 'RUN_SUSPENDED' })
    );

    // Set LLM fixture for after approval
    await setLLMFixture('completion-after-tool.json');

    // Approve
    const resumeRes = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', feedback: '' }),
    });
    expect(resumeRes.ok).toBe(true);

    // Wait for completion
    const completedRun = await waitForRunStatus(runId, 'completed', 30000);
    expect(completedRun.status).toBe('completed');

    // Verify tool was executed
    const finalEventsRes = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/events`);
    const finalEvents = await finalEventsRes.json();
    expect(finalEvents).toContainEqual(
      expect.objectContaining({
        event_type: 'TOOL_RESULT',
        payload: expect.objectContaining({ status: 'success' })
      })
    );
  }, 90000);

  it('handles rejection and continues', async () => {
    await setLLMFixture('dangerous-shell.json');
    const runId = await createTestRun('Execute rm command');

    await waitForRunStatus(runId, 'suspended', 30000);

    // Set LLM to respond appropriately after rejection
    await setLLMFixture('acknowledge-rejection.json');

    // Reject
    await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'rejected',
        feedback: 'This command is too dangerous'
      }),
    });

    // Run should continue (not fail)
    const eventsRes = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/events`);
    const events = await eventsRes.json();

    expect(events).toContainEqual(
      expect.objectContaining({
        event_type: 'RUN_RESUMED',
        payload: expect.objectContaining({ decision: 'rejected' })
      })
    );
  }, 90000);

  it('cancels run successfully', async () => {
    await setLLMFixture('dangerous-shell.json');
    const runId = await createTestRun('Long running task');

    await waitForRunStatus(runId, 'suspended', 30000);

    // Cancel
    const cancelRes = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/cancel`, {
      method: 'POST',
    });
    expect(cancelRes.ok).toBe(true);

    const run = await waitForRunStatus(runId, 'cancelled', 10000);
    expect(run.status).toBe('cancelled');
  }, 60000);
});
```

### 2.4 Recovery Tests

**`src/__tests__/e2e/recovery.e2e.test.ts`**:
```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  waitForService,
  setLLMFixture,
  createTestRun,
  waitForRunStatus,
  TEST_CONFIG
} from './setup';

const execAsync = promisify(exec);

describe('Crash Recovery E2E', () => {
  beforeAll(async () => {
    await waitForService(TEST_CONFIG.apiUrl);
  }, 60000);

  it('resumes run after server restart', async () => {
    // Set LLM to return dangerous tool (will suspend)
    await setLLMFixture('dangerous-shell.json');

    const runId = await createTestRun('Task that will suspend');
    await waitForRunStatus(runId, 'suspended', 30000);

    // Restart agent server container
    await execAsync('docker compose -f docker-compose.test.yaml restart agent-server-test');

    // Wait for server to come back
    await waitForService(TEST_CONFIG.apiUrl, 60);

    // Run should still be suspended (Inngest maintains state)
    const run = await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}`).then(r => r.json());
    expect(run.status).toBe('suspended');

    // Set fixture for completion
    await setLLMFixture('completion-after-tool.json');

    // Resume should work
    await fetch(`${TEST_CONFIG.apiUrl}/api/runs/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    });

    const completedRun = await waitForRunStatus(runId, 'completed', 30000);
    expect(completedRun.status).toBe('completed');
  }, 120000);
});
```

---

## Part 3: Playwright Browser E2E Tests

### 3.1 Playwright Configuration

**`ops/packages/dashboard/e2e/playwright.config.ts`**:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: process.env.DASHBOARD_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'docker compose -f docker-compose.test.yaml up',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

### 3.2 Test Fixtures

**`ops/packages/dashboard/e2e/fixtures/test-fixtures.ts`**:
```typescript
import { test as base } from '@playwright/test';

type TestFixtures = {
  apiUrl: string;
  mockLlmUrl: string;
  createRun: (prompt: string) => Promise<string>;
  setLLMFixture: (fixture: string) => Promise<void>;
  waitForStatus: (runId: string, status: string) => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  apiUrl: async ({}, use) => {
    await use(process.env.API_URL || 'http://localhost:3200');
  },

  mockLlmUrl: async ({}, use) => {
    await use(process.env.MOCK_LLM_URL || 'http://localhost:3333');
  },

  createRun: async ({ apiUrl }, use) => {
    await use(async (prompt: string) => {
      const res = await fetch(`${apiUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, agentType: 'orchestrator' }),
      });
      const { id } = await res.json();
      return id;
    });
  },

  setLLMFixture: async ({ mockLlmUrl }, use) => {
    await use(async (fixture: string) => {
      await fetch(`${mockLlmUrl}/fixtures/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture }),
      });
    });
  },

  waitForStatus: async ({ apiUrl }, use) => {
    await use(async (runId: string, status: string) => {
      const timeout = 30000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const res = await fetch(`${apiUrl}/api/runs/${runId}`);
        const run = await res.json();
        if (run.status === status) return;
        await new Promise(r => setTimeout(r, 500));
      }
      throw new Error(`Timeout waiting for status ${status}`);
    });
  },
});

export { expect } from '@playwright/test';
```

### 3.3 Approval Flow Test

**`ops/packages/dashboard/e2e/specs/approval-flow.spec.ts`**:
```typescript
import { test, expect } from '../fixtures/test-fixtures';

test.describe('HITL Approval Flow', () => {
  test('approves dangerous tool via UI', async ({
    page,
    setLLMFixture,
    createRun,
    waitForStatus
  }) => {
    // Setup: LLM will return dangerous tool
    await setLLMFixture('dangerous-shell.json');

    // Create run via API
    const runId = await createRun('Execute ls command');

    // Navigate to run page
    await page.goto(`/runs/${runId}`);

    // Wait for suspended state
    await expect(page.getByTestId('status-badge')).toHaveText('SUSPENDED', {
      timeout: 30000
    });

    // Verify approval card appears
    await expect(page.getByTestId('approval-card')).toBeVisible();
    await expect(page.getByTestId('tool-name')).toContainText('shell_command_execute');
    await expect(page.getByTestId('tool-args')).toContainText('ls -la');

    // Set fixture for post-approval
    await setLLMFixture('completion-after-tool.json');

    // Click approve
    await page.getByTestId('approve-button').click();

    // Wait for completion
    await expect(page.getByTestId('status-badge')).toHaveText('COMPLETED', {
      timeout: 30000
    });

    // Verify tool result appears in timeline
    await expect(page.getByTestId('event-TOOL_RESULT')).toBeVisible();
  });

  test('rejects dangerous tool via UI with feedback', async ({
    page,
    setLLMFixture,
    createRun
  }) => {
    await setLLMFixture('dangerous-shell.json');
    const runId = await createRun('Execute dangerous command');

    await page.goto(`/runs/${runId}`);
    await expect(page.getByTestId('status-badge')).toHaveText('SUSPENDED', {
      timeout: 30000
    });

    // Click reject
    await page.getByTestId('reject-button').click();

    // Enter feedback
    await page.getByTestId('feedback-input').fill('This command is too dangerous');
    await page.getByTestId('confirm-reject-button').click();

    // Verify rejection recorded
    await expect(page.getByTestId('event-RUN_RESUMED')).toBeVisible();
    await expect(page.getByText('rejected')).toBeVisible();
  });
});
```

### 3.4 Real-Time Updates Test

**`ops/packages/dashboard/e2e/specs/real-time-updates.spec.ts`**:
```typescript
import { test, expect } from '../fixtures/test-fixtures';

test.describe('Real-Time Updates', () => {
  test('dashboard updates in real-time as events occur', async ({
    page,
    setLLMFixture,
    createRun
  }) => {
    await setLLMFixture('multi-step.json');

    await page.goto('/');

    // Create run from dashboard
    await page.getByTestId('prompt-input').fill('Multi-step task');
    await page.getByTestId('create-run-button').click();

    // Verify run appears in list
    await expect(page.getByTestId('run-item').first()).toBeVisible({ timeout: 5000 });

    // Click into run
    await page.getByTestId('run-item').first().click();

    // Verify events stream in
    await expect(page.getByTestId('event-RUN_STARTED')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('event-AGENT_THOUGHT')).toBeVisible({ timeout: 15000 });
  });

  test('multiple tabs stay synchronized', async ({
    page,
    context,
    setLLMFixture,
    createRun
  }) => {
    await setLLMFixture('dangerous-shell.json');
    const runId = await createRun('Sync test');

    // Open run in two tabs
    const page1 = page;
    const page2 = await context.newPage();

    await page1.goto(`/runs/${runId}`);
    await page2.goto(`/runs/${runId}`);

    // Wait for suspension on both
    await expect(page1.getByTestId('status-badge')).toHaveText('SUSPENDED', { timeout: 30000 });
    await expect(page2.getByTestId('status-badge')).toHaveText('SUSPENDED');

    // Approve in tab 1
    await setLLMFixture('completion-after-tool.json');
    await page1.getByTestId('approve-button').click();

    // Verify tab 2 updates automatically
    await expect(page2.getByTestId('status-badge')).toHaveText('COMPLETED', {
      timeout: 15000
    });
  });
});
```

### 3.5 Required Dashboard Test IDs

Add these `data-testid` attributes to dashboard components:

| Component | Test ID |
|-----------|---------|
| Status badge | `status-badge` |
| Approval card | `approval-card` |
| Tool name display | `tool-name` |
| Tool args display | `tool-args` |
| Approve button | `approve-button` |
| Reject button | `reject-button` |
| Feedback input | `feedback-input` |
| Confirm reject button | `confirm-reject-button` |
| Prompt input | `prompt-input` |
| Create run button | `create-run-button` |
| Run list item | `run-item` |
| Event by type | `event-{EVENT_TYPE}` (e.g., `event-RUN_STARTED`) |

---

## Part 4: Test Commands

### Package.json Scripts

**`ops/packages/agent-server/package.json`**:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config jest.e2e.config.js",
    "test:e2e:setup": "docker compose -f ../../docker-compose.test.yaml up -d",
    "test:e2e:teardown": "docker compose -f ../../docker-compose.test.yaml down"
  }
}
```

**`ops/packages/dashboard/package.json`**:
```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed"
  }
}
```

### Running Tests

```bash
# Unit tests
cd ops/packages/agent-server && npm test

# Backend E2E (requires test containers)
npm run test:e2e:setup
npm run test:e2e
npm run test:e2e:teardown

# Playwright browser E2E
cd ops/packages/dashboard
npx playwright install  # First time only
npm run test:e2e
```

---

## Part 5: CI/CD Integration

### GitHub Actions Workflow

**`.github/workflows/test.yaml`**:
```yaml
name: Tests

on:
  push:
    branches: [main, inngest]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
        working-directory: ops/packages/agent-server

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci

      - name: Start test environment
        run: docker compose -f docker-compose.test.yaml up -d --wait

      - name: Run backend E2E tests
        run: npm run test:e2e
        working-directory: ops/packages/agent-server

      - name: Stop test environment
        if: always()
        run: docker compose -f docker-compose.test.yaml down

  playwright-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
        working-directory: ops/packages/dashboard

      - name: Start test environment
        run: docker compose -f docker-compose.test.yaml up -d --wait

      - name: Run Playwright tests
        run: npm run test:e2e
        working-directory: ops/packages/dashboard

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: ops/packages/dashboard/playwright-report/

      - name: Stop test environment
        if: always()
        run: docker compose -f docker-compose.test.yaml down
```

---

## Part 6: Phase Gates

| Phase | Required Tests | Gate Criteria |
|-------|----------------|---------------|
| Phase 1 (Inngest MVP) | Unit tests | All unit tests pass |
| **Phase 1.5 (Testing Infra)** | N/A | Test commands work, mock LLM responds |
| Phase 2 (AgentKit + Backend E2E) | Backend E2E | All E2E tests pass |
| Phase 3 (OpenTelemetry) | Existing tests | No regressions |
| Phase 4 (Dashboard + Playwright) | Playwright E2E | All Playwright tests pass |
| Phase 5 (Metrics) | All | Full test suite passes |
| Phase 6 (Cleanup) | All | No regressions after deletion |

---

## Appendix: Mock LLM Fixtures

### Safe Read File (`safe-read-file.json`)
```json
{
  "content": [
    { "type": "text", "text": "I'll read the file for you." },
    {
      "type": "tool_use",
      "id": "call-safe-1",
      "name": "read_file",
      "input": { "path": "/workspace/README.md" }
    }
  ],
  "stop_reason": "tool_use"
}
```

### Dangerous Shell (`dangerous-shell.json`)
```json
{
  "content": [
    { "type": "text", "text": "I need to execute a shell command." },
    {
      "type": "tool_use",
      "id": "call-dangerous-1",
      "name": "shell_command_execute",
      "input": { "command": "ls -la" }
    }
  ],
  "stop_reason": "tool_use"
}
```

### Completion After Tool (`completion-after-tool.json`)
```json
{
  "content": [
    { "type": "text", "text": "The command executed successfully. Here are the results..." }
  ],
  "stop_reason": "end_turn"
}
```

### Acknowledge Rejection (`acknowledge-rejection.json`)
```json
{
  "content": [
    { "type": "text", "text": "I understand. The command was rejected. Let me try a different approach." }
  ],
  "stop_reason": "end_turn"
}
```

### LLM Error (`llm-error.json`)
```json
{
  "error": true,
  "error_type": "rate_limit_error",
  "message": "Rate limit exceeded. Please retry after 60 seconds.",
  "content": [],
  "stop_reason": null,
  "usage": null
}
```

---

## Troubleshooting

### Port Conflicts

**Issue**: Test environment won't start because port 3200 is already in use.

**Cause**: The main development stack (`docker-compose.yaml`) uses port 3200 for the agent server. If it's running, the test stack cannot bind to the same port.

**Solution**: The test environment uses port **3210** for the agent-server-test container to avoid this conflict.

| Stack | Agent Server Port | Notes |
|-------|------------------|-------|
| Main (`docker-compose.yaml`) | 3200 | Development environment |
| Test (`docker-compose.test.yaml`) | 3210 | Test environment |

**If you see this error**:
```
Error starting userland proxy: listen tcp4 0.0.0.0:3200: bind: address already in use
```

**Fix**: Either stop the main stack first, or verify you're using the correct test port (3210).

```bash
# Stop main stack before running tests
docker compose down

# Or run tests (they use port 3210, should work alongside main stack)
docker compose -f docker-compose.test.yaml up -d
```

### Healthcheck Failures

**Issue**: Services fail healthcheck on startup.

**Cause**: Different containers have different tools available.

| Service | Healthcheck Tool | Notes |
|---------|-----------------|-------|
| mock-llm | `wget` | Alpine-based, wget available |
| inngest-test | `curl` | Inngest image has curl |
| agent-db-test | `pg_isready` | PostgreSQL native tool |
| agent-server-test | `wget` | Alpine-based Node image |
| dashboard-test | `wget` | Alpine-based Nginx |

**If healthchecks fail**, check the docker-compose.test.yaml to ensure the correct tool is used for each service.

### Mock LLM Fixture State

**Issue**: Tests intermittently fail due to wrong LLM responses.

**Cause**: Fixture state from previous tests bleeding into subsequent tests.

**Solution**: Tests should reset fixture state after each test:
```typescript
afterEach(async () => {
  await clearLLMQueue();
  await setLLMFixture('default.json');
});
```

This pattern is implemented in the smoke tests and should be followed in all E2E test files.
