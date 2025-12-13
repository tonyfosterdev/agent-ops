/**
 * End-to-End Smoke Tests
 *
 * Comprehensive tests that verify the full workflow:
 * session → run → SSE → context
 */

import { TestServer } from './utils/TestServer.js';
import { TestClient } from './utils/TestClient.js';
import { SSEClient } from './utils/SSEClient.js';
import { TEST_AUTH } from './setup.js';

describe('End-to-End Smoke Test', () => {
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

  it('full workflow: session → run → SSE → context', async () => {
    // 1. Create session
    const { sessionId } = await client.createSession('mock', 'Smoke Test Session');

    expect(sessionId).toBeDefined();

    // 2. Start first run
    const { runId: run1Id } = await client.startRun(sessionId, 'First task: analyze data');

    expect(run1Id).toBeDefined();

    // 3. Subscribe to SSE and wait for completion
    const subscription1 = sseClient.subscribe(run1Id);
    const complete1 = await subscription1.waitForComplete();

    expect(complete1.status).toBe('completed');
    expect(complete1.result?.success).toBe(true);

    // 4. Verify entries received
    const entries1 = subscription1.getAllEntries();

    expect(entries1[0].entry_type).toBe('run:started');
    expect(entries1.some((e) => e.entry_type === 'text')).toBe(true);
    expect(entries1.some((e) => e.entry_type === 'tool:starting')).toBe(true);
    expect(entries1.some((e) => e.entry_type === 'tool:complete')).toBe(true);
    expect(entries1.some((e) => e.entry_type === 'step:complete')).toBe(true);
    expect(entries1[entries1.length - 1].entry_type).toBe('run:complete');

    // 5. Start second run (should have context from first run)
    const { runId: run2Id } = await client.startRun(sessionId, 'Second task: build on analysis');

    const subscription2 = sseClient.subscribe(run2Id);
    const complete2 = await subscription2.waitForComplete();

    expect(complete2.status).toBe('completed');

    // 6. Verify session contains both runs
    const session = await client.getSession(sessionId);

    expect(session.session.id).toBe(sessionId);
    expect(session.session.title).toBe('Smoke Test Session');
    expect(session.runs.length).toBe(2);
    expect(session.runs[0].runNumber).toBe(1);
    expect(session.runs[0].task).toBe('First task: analyze data');
    expect(session.runs[1].runNumber).toBe(2);
    expect(session.runs[1].task).toBe('Second task: build on analysis');

    // 7. Verify runs have results
    const run1 = await client.getRun(run1Id);
    const run2 = await client.getRun(run2Id);

    expect(run1.run.status).toBe('completed');
    expect(run1.run.result?.success).toBe(true);
    expect(run2.run.status).toBe('completed');
    expect(run2.run.result?.success).toBe(true);
  });

  it('handles multiple concurrent sessions', async () => {
    // Create two sessions simultaneously
    const [session1, session2] = await Promise.all([
      client.createSession('mock', 'Concurrent Session 1'),
      client.createSession('mock', 'Concurrent Session 2'),
    ]);

    expect(session1.sessionId).not.toBe(session2.sessionId);

    // Start runs in both sessions concurrently
    const [run1, run2] = await Promise.all([
      client.startRun(session1.sessionId, 'Task in session 1'),
      client.startRun(session2.sessionId, 'Task in session 2'),
    ]);

    // Subscribe to both
    const [sub1, sub2] = [sseClient.subscribe(run1.runId), sseClient.subscribe(run2.runId)];

    // Wait for both to complete
    const [complete1, complete2] = await Promise.all([
      sub1.waitForComplete(),
      sub2.waitForComplete(),
    ]);

    expect(complete1.status).toBe('completed');
    expect(complete2.status).toBe('completed');

    // Verify sessions are independent
    const s1 = await client.getSession(session1.sessionId);
    const s2 = await client.getSession(session2.sessionId);

    expect(s1.runs.length).toBe(1);
    expect(s2.runs.length).toBe(1);
    expect(s1.runs[0].task).toBe('Task in session 1');
    expect(s2.runs[0].task).toBe('Task in session 2');
  });

  it('SSE entries arrive in real-time order', async () => {
    const { sessionId } = await client.createSession('mock');
    const { runId } = await client.startRun(sessionId, 'Real-time order test');

    const subscription = sseClient.subscribe(runId);
    await subscription.waitForComplete();

    const entries = subscription.getAllEntries();

    // Verify chronological order by created_at timestamps
    for (let i = 1; i < entries.length; i++) {
      const prevTime = new Date(entries[i - 1].created_at).getTime();
      const currTime = new Date(entries[i].created_at).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }

    // Verify logical order of entry types
    const types = entries.map((e) => e.entry_type);
    const startIndex = types.indexOf('run:started');
    const completeIndex = types.indexOf('run:complete');

    expect(startIndex).toBe(0); // run:started must be first
    expect(completeIndex).toBe(types.length - 1); // run:complete must be last
  });

  it('session can be archived after runs complete', async () => {
    const { sessionId } = await client.createSession('mock', 'Session to Archive');

    // Run a task
    const { runId } = await client.startRun(sessionId, 'Task before archive');
    const subscription = sseClient.subscribe(runId);
    await subscription.waitForComplete();

    // Archive session
    const archiveResult = await client.archiveSession(sessionId);
    expect(archiveResult.success).toBe(true);

    // Verify archived status
    const session = await client.getSession(sessionId);
    expect(session.session.status).toBe('archived');

    // Archived session should not appear in active list
    const activeSessions = await client.listSessions({ status: 'active' });
    expect(activeSessions.find((s) => s.id === sessionId)).toBeUndefined();

    // But should appear in archived list
    const archivedSessions = await client.listSessions({ status: 'archived' });
    expect(archivedSessions.find((s) => s.id === sessionId)).toBeDefined();
  });

  it('health check endpoint is accessible without auth', async () => {
    const health = await client.healthCheck();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('agent-server');
    expect(health.timestamp).toBeDefined();
  });

  it('agent direct run creates session automatically', async () => {
    // Use the /agents/:type/run endpoint without sessionId
    const response = await client.runAgent('mock', 'Direct agent run test');

    expect(response.runId).toBeDefined();
    expect(response.sessionId).toBeDefined();

    // Subscribe and wait for completion
    const subscription = sseClient.subscribe(response.runId);
    const complete = await subscription.waitForComplete();

    expect(complete.status).toBe('completed');

    // Verify session was created
    const session = await client.getSession(response.sessionId);
    expect(session.session.agentType).toBe('mock');
    expect(session.runs.length).toBe(1);
  });

  it('subsequent runs in same session share context', async () => {
    const { sessionId } = await client.createSession('mock', 'Context Sharing Test');

    // First run
    const { runId: run1Id } = await client.startRun(sessionId, 'Remember this: secret123');
    let sub = sseClient.subscribe(run1Id);
    await sub.waitForComplete();

    // Second run - context should include first run
    const { runId: run2Id } = await client.startRun(sessionId, 'What did I tell you to remember?');
    sub = sseClient.subscribe(run2Id);
    await sub.waitForComplete();

    // Third run - context should include both previous runs
    const { runId: run3Id } = await client.startRun(sessionId, 'Summarize our conversation');
    sub = sseClient.subscribe(run3Id);
    await sub.waitForComplete();

    // Verify all three runs completed successfully
    const session = await client.getSession(sessionId);
    expect(session.runs.length).toBe(3);
    expect(session.runs.every((r) => r.status === 'completed')).toBe(true);
  });
});
