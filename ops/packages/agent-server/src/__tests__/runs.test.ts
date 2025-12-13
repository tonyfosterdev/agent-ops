/**
 * Run and SSE Tests
 *
 * Tests for run creation, retrieval, and SSE subscription.
 */

import { TestServer } from './utils/TestServer.js';
import { TestClient } from './utils/TestClient.js';
import { SSEClient } from './utils/SSEClient.js';
import { TEST_AUTH } from './setup.js';

describe('Runs API', () => {
  let server: TestServer;
  let client: TestClient;

  beforeAll(async () => {
    server = new TestServer();
    await server.start();
    client = new TestClient(server.getBaseUrl(), TEST_AUTH);
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('POST /sessions/:sessionId/runs', () => {
    it('creates a run within a session', async () => {
      const { sessionId } = await client.createSession('mock');

      const response = await client.startRun(sessionId, 'Test task');

      expect(response.runId).toBeDefined();
      expect(response.subscribeUrl).toBe(`/runs/${response.runId}/subscribe`);
    });

    it('increments run number for subsequent runs', async () => {
      const { sessionId } = await client.createSession('mock');

      await client.startRun(sessionId, 'First task');
      await client.startRun(sessionId, 'Second task');

      // Wait for runs to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const session = await client.getSession(sessionId);
      expect(session.runs.length).toBe(2);
      expect(session.runs[0].runNumber).toBe(1);
      expect(session.runs[1].runNumber).toBe(2);
    });

    it('returns 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(client.startRun(fakeId, 'Task')).rejects.toThrow('HTTP 404');
    });
  });

  describe('GET /runs/:runId', () => {
    it('returns run details with entries', async () => {
      const { sessionId } = await client.createSession('mock');
      const { runId } = await client.startRun(sessionId, 'Detail test task');

      // Wait for mock agent to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await client.getRun(runId);

      expect(response.run.id).toBe(runId);
      expect(response.run.sessionId).toBe(sessionId);
      expect(response.run.task).toBe('Detail test task');
      expect(response.run.agentType).toBe('mock');
      expect(response.run.status).toBe('completed');
      expect(response.entries.length).toBeGreaterThan(0);
    });

    it('returns entries in correct order', async () => {
      const { sessionId } = await client.createSession('mock');
      const { runId } = await client.startRun(sessionId, 'Order test');

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await client.getRun(runId);
      const entryTypes = response.entries.map((e) => e.entryType);

      // First entry should be run:started
      expect(entryTypes[0]).toBe('run:started');

      // Last entry should be run:complete
      expect(entryTypes[entryTypes.length - 1]).toBe('run:complete');
    });

    it('returns 404 for non-existent run', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(client.getRun(fakeId)).rejects.toThrow('HTTP 404');
    });
  });
});

describe('SSE Subscription', () => {
  let server: TestServer;
  let client: TestClient;
  let sseClient: SSEClient;

  beforeAll(async () => {
    server = new TestServer();
    await server.start();
    client = new TestClient(server.getBaseUrl(), TEST_AUTH);
    sseClient = new SSEClient(server.getBaseUrl(), TEST_AUTH);
  });

  afterAll(async () => {
    await server.stop();
  });

  it('receives all journal entries in order', async () => {
    const { sessionId } = await client.createSession('mock');
    const { runId } = await client.startRun(sessionId, 'SSE test task');

    const subscription = sseClient.subscribe(runId);

    // Wait for completion
    const complete = await subscription.waitForComplete();

    expect(complete.status).toBe('completed');

    // Check entries are in order
    const entries = subscription.getAllEntries();
    expect(entries.length).toBeGreaterThan(0);

    // Verify sequence
    for (let i = 1; i < entries.length; i++) {
      const prevTime = new Date(entries[i - 1].created_at).getTime();
      const currTime = new Date(entries[i].created_at).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }
  });

  it('receives run:started as first entry', async () => {
    const { sessionId } = await client.createSession('mock');
    const { runId } = await client.startRun(sessionId, 'First entry test');

    const subscription = sseClient.subscribe(runId);
    await subscription.waitForComplete();

    const entries = subscription.getAllEntries();
    expect(entries[0].entry_type).toBe('run:started');
    expect(entries[0].data).toMatchObject({
      task: 'First entry test',
      agentType: 'mock',
    });
  });

  it('receives run:complete as final entry', async () => {
    const { sessionId } = await client.createSession('mock');
    const { runId } = await client.startRun(sessionId, 'Final entry test');

    const subscription = sseClient.subscribe(runId);
    await subscription.waitForComplete();

    const entries = subscription.getAllEntries();
    const lastEntry = entries[entries.length - 1];

    expect(lastEntry.entry_type).toBe('run:complete');
    expect(lastEntry.data).toMatchObject({
      success: true,
      steps: expect.any(Number),
    });
  });

  it('receives complete event with run status', async () => {
    const { sessionId } = await client.createSession('mock');
    const { runId } = await client.startRun(sessionId, 'Complete event test');

    const subscription = sseClient.subscribe(runId);
    const complete = await subscription.waitForComplete();

    expect(complete.id).toBe(runId);
    expect(complete.status).toBe('completed');
    expect(complete.result).toBeDefined();
    expect(complete.result?.success).toBe(true);
  });

  it('receives tool execution entries', async () => {
    const { sessionId } = await client.createSession('mock');
    const { runId } = await client.startRun(sessionId, 'Tool test');

    const subscription = sseClient.subscribe(runId);
    await subscription.waitForComplete();

    const toolStartEntries = subscription.getEntriesByType('tool:starting');
    const toolCompleteEntries = subscription.getEntriesByType('tool:complete');

    expect(toolStartEntries.length).toBeGreaterThan(0);
    expect(toolCompleteEntries.length).toBeGreaterThan(0);

    // Each tool:starting should have a matching tool:complete
    expect(toolStartEntries.length).toBe(toolCompleteEntries.length);
  });

  it('receives text entries', async () => {
    const { sessionId } = await client.createSession('mock');
    const { runId } = await client.startRun(sessionId, 'Text test');

    const subscription = sseClient.subscribe(runId);
    await subscription.waitForComplete();

    const textEntries = subscription.getEntriesByType('text');

    expect(textEntries.length).toBeGreaterThan(0);
    expect(textEntries[0].data.text).toBeDefined();
  });
});
