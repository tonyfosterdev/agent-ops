/**
 * Session API Tests
 *
 * Tests for session CRUD operations.
 */

import { TestServer } from './utils/TestServer.js';
import { TestClient } from './utils/TestClient.js';
import { TEST_AUTH } from './setup.js';

describe('Sessions API', () => {
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

  describe('POST /sessions', () => {
    it('creates a new session with required fields', async () => {
      const response = await client.createSession('mock');

      expect(response.sessionId).toBeDefined();
      expect(typeof response.sessionId).toBe('string');
      expect(response.runUrl).toBe(`/sessions/${response.sessionId}/runs`);
    });

    it('creates a session with optional title', async () => {
      const response = await client.createSession('mock', 'Test Session');

      expect(response.sessionId).toBeDefined();

      // Verify the title was saved
      const session = await client.getSession(response.sessionId);
      expect(session.session.title).toBe('Test Session');
    });

    it('accepts all valid agent types', async () => {
      const types = ['coding', 'log-analyzer', 'orchestration', 'mock'] as const;

      for (const agentType of types) {
        const response = await client.createSession(agentType);
        expect(response.sessionId).toBeDefined();

        const session = await client.getSession(response.sessionId);
        expect(session.session.agentType).toBe(agentType);
      }
    });

    it('rejects invalid agent types', async () => {
      await expect(client.createSession('invalid-type' as any)).rejects.toThrow(
        'HTTP 400'
      );
    });
  });

  describe('GET /sessions/:sessionId', () => {
    it('returns session details', async () => {
      const { sessionId } = await client.createSession('mock', 'Detail Test');

      const response = await client.getSession(sessionId);

      expect(response.session.id).toBe(sessionId);
      expect(response.session.agentType).toBe('mock');
      expect(response.session.title).toBe('Detail Test');
      expect(response.session.status).toBe('active');
      expect(response.session.createdAt).toBeDefined();
      expect(response.session.updatedAt).toBeDefined();
      expect(response.runs).toEqual([]);
    });

    it('returns 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(client.getSession(fakeId)).rejects.toThrow('HTTP 404');
    });
  });

  describe('GET /sessions', () => {
    it('lists all sessions', async () => {
      // Create some sessions
      await client.createSession('mock', 'Session 1');
      await client.createSession('mock', 'Session 2');

      const sessions = await client.listSessions();

      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by status', async () => {
      const { sessionId } = await client.createSession('mock', 'To Archive');
      await client.archiveSession(sessionId);

      const activeSessions = await client.listSessions({ status: 'active' });
      const archivedSessions = await client.listSessions({ status: 'archived' });

      const activeIds = activeSessions.map((s) => s.id);
      const archivedIds = archivedSessions.map((s) => s.id);

      expect(activeIds).not.toContain(sessionId);
      expect(archivedIds).toContain(sessionId);
    });

    it('filters by agent type', async () => {
      // Create sessions with different types
      const { sessionId: mockId } = await client.createSession('mock', 'Mock Session');
      const { sessionId: codingId } = await client.createSession('coding', 'Coding Session');

      const mockSessions = await client.listSessions({ agentType: 'mock' });
      const codingSessions = await client.listSessions({ agentType: 'coding' });

      // The created sessions should be in the filtered results
      expect(mockSessions.some((s) => s.id === mockId)).toBe(true);
      expect(codingSessions.some((s) => s.id === codingId)).toBe(true);

      // And should NOT be in the wrong filter results
      expect(mockSessions.some((s) => s.id === codingId)).toBe(false);
      expect(codingSessions.some((s) => s.id === mockId)).toBe(false);
    });

    it('respects limit and offset', async () => {
      // Create several sessions
      for (let i = 0; i < 5; i++) {
        await client.createSession('mock', `Pagination Session ${i}`);
      }

      const firstPage = await client.listSessions({ limit: 2, offset: 0 });
      const secondPage = await client.listSessions({ limit: 2, offset: 2 });

      expect(firstPage.length).toBe(2);
      expect(secondPage.length).toBe(2);

      // Should be different sessions
      const firstIds = new Set(firstPage.map((s) => s.id));
      const hasOverlap = secondPage.some((s) => firstIds.has(s.id));
      expect(hasOverlap).toBe(false);
    });
  });

  describe('POST /sessions/:sessionId/archive', () => {
    it('archives an active session', async () => {
      const { sessionId } = await client.createSession('mock', 'To Be Archived');

      const result = await client.archiveSession(sessionId);
      expect(result.success).toBe(true);

      const session = await client.getSession(sessionId);
      expect(session.session.status).toBe('archived');
    });

    it('returns 404 for non-existent session', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(client.archiveSession(fakeId)).rejects.toThrow('HTTP 404');
    });
  });
});
