/**
 * Approval System Tests
 *
 * Tests for the HITM (Human-in-the-Middle) approval system.
 */

import { TestServer } from './utils/TestServer.js';
import { TestClient } from './utils/TestClient.js';
import { TEST_AUTH, TestDataSource } from './setup.js';
import { ApprovalService } from '../services/ApprovalService.js';
import { ToolApproval } from '../entities/ToolApproval.js';
import { AgentRun } from '../entities/AgentRun.js';
import { Session } from '../entities/Session.js';

describe('ApprovalService', () => {
  let approvalService: ApprovalService;
  let runId: string;

  beforeEach(async () => {
    approvalService = new ApprovalService();

    // Create a session and run for testing
    const sessionRepo = TestDataSource.getRepository(Session);
    const runRepo = TestDataSource.getRepository(AgentRun);

    const session = sessionRepo.create({
      agent_type: 'coding',
      name: 'Test Session',
      status: 'active',
    });
    await sessionRepo.save(session);

    const run = runRepo.create({
      session_id: session.id,
      run_number: 1,
      agent_type: 'coding',
      task: 'Test task',
      status: 'running',
      config: { maxSteps: 5 },
    });
    await runRepo.save(run);
    runId = run.id;
  });

  describe('requestApproval', () => {
    it('creates a pending approval in database and resolves on approve', async () => {
      // Start approval request
      const approvalPromise = approvalService.requestApproval({
        runId,
        toolCallId: 'test-tool-1',
        toolName: 'read_file',
        args: { path: '/test/file.txt' },
        stepNumber: 1,
      });

      // Wait for the approval to be created in DB, then find and approve it
      await new Promise((resolve) => setTimeout(resolve, 50));
      const approval = await approvalService.getByToolCallId(runId, 'test-tool-1');
      expect(approval).toBeDefined();
      expect(approval?.status).toBe('pending');

      await approvalService.approve(approval!.id);

      const result = await approvalPromise;
      expect(result.status).toBe('approved');
    });

    it('returns timeout on long wait', async () => {
      const result = await approvalService.requestApproval(
        {
          runId,
          toolCallId: 'test-tool-timeout',
          toolName: 'read_file',
          args: { path: '/test/file.txt' },
          stepNumber: 1,
        },
        100 // Short timeout for testing
      );

      expect(result.status).toBe('timeout');
    });
  });

  describe('approve', () => {
    it('updates approval status to approved', async () => {
      // Create a pending approval directly
      const approvalRepo = TestDataSource.getRepository(ToolApproval);
      const approval = approvalRepo.create({
        run_id: runId,
        tool_call_id: 'test-tool-2',
        tool_name: 'read_file',
        args: { path: '/test' },
        step_number: 1,
        status: 'pending',
      });
      const saved = await approvalRepo.save(approval);

      // approve() takes the approval ID, not runId/toolCallId
      const result = await approvalService.approve(saved.id);
      expect(result).toBe(true);

      const updated = await approvalRepo.findOne({
        where: { id: saved.id },
      });
      expect(updated?.status).toBe('approved');
      expect(updated?.resolved_at).toBeDefined();
    });

    it('returns false for non-existent approval', async () => {
      const result = await approvalService.approve('00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('reject', () => {
    it('updates approval status to rejected with reason', async () => {
      const approvalRepo = TestDataSource.getRepository(ToolApproval);
      const approval = approvalRepo.create({
        run_id: runId,
        tool_call_id: 'test-tool-3',
        tool_name: 'shell_command',
        args: { command: 'rm -rf /' },
        step_number: 1,
        status: 'pending',
      });
      const saved = await approvalRepo.save(approval);

      // reject() takes the approval ID, not runId/toolCallId
      const result = await approvalService.reject(saved.id, 'Dangerous command');
      expect(result).toBe(true);

      const updated = await approvalRepo.findOne({
        where: { id: saved.id },
      });
      expect(updated?.status).toBe('rejected');
      expect(updated?.rejection_reason).toBe('Dangerous command');
      expect(updated?.resolved_at).toBeDefined();
    });
  });

  describe('getPendingApproval', () => {
    it('returns pending approval for run', async () => {
      const approvalRepo = TestDataSource.getRepository(ToolApproval);
      await approvalRepo.save({
        run_id: runId,
        tool_call_id: 'pending-tool',
        tool_name: 'read_file',
        args: { path: '/test' },
        step_number: 1,
        status: 'pending',
      });

      const pending = await approvalService.getPendingApproval(runId);
      expect(pending).toBeDefined();
      expect(pending?.tool_call_id).toBe('pending-tool');
    });

    it('returns null when no pending approvals', async () => {
      const pending = await approvalService.getPendingApproval(runId);
      expect(pending).toBeNull();
    });
  });
});

describe('Approval API', () => {
  let server: TestServer;
  let client: TestClient;
  let runId: string;

  beforeAll(async () => {
    server = new TestServer();
    await server.start();
    client = new TestClient(server.getBaseUrl(), TEST_AUTH);
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    // Create a session and run for testing
    const { sessionId } = await client.createSession('mock');
    const { runId: newRunId } = await client.startRun(sessionId, 'API Test');
    runId = newRunId;

    // Wait for run to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  describe('GET /runs/:runId/pending-approval', () => {
    it('returns pending: false when no pending approval', async () => {
      const response = await client.get(`/runs/${runId}/pending-approval`);
      expect(response.pending).toBe(false);
    });

    it('returns pending approval when one exists', async () => {
      // Create a pending approval directly in DB
      const approvalRepo = TestDataSource.getRepository(ToolApproval);
      await approvalRepo.save({
        run_id: runId,
        tool_call_id: 'api-test-tool',
        tool_name: 'read_file',
        args: { path: '/test' },
        step_number: 1,
        status: 'pending',
      });

      const response = await client.get(`/runs/${runId}/pending-approval`);
      expect(response.pending).toBe(true);
      expect(response.approval).toBeDefined();
      expect(response.approval.toolCallId).toBe('api-test-tool');
      expect(response.approval.toolName).toBe('read_file');
    });
  });

  describe('POST /runs/:runId/tools/:toolCallId/approve', () => {
    it('approves a pending tool', async () => {
      const approvalRepo = TestDataSource.getRepository(ToolApproval);
      await approvalRepo.save({
        run_id: runId,
        tool_call_id: 'approve-test-tool',
        tool_name: 'read_file',
        args: { path: '/test' },
        step_number: 1,
        status: 'pending',
      });

      const response = await client.post(
        `/runs/${runId}/tools/approve-test-tool/approve`
      );
      expect(response.success).toBe(true);
      expect(response.status).toBe('approved');
    });

    it('returns 404 for non-existent tool', async () => {
      await expect(
        client.post(`/runs/${runId}/tools/non-existent/approve`)
      ).rejects.toThrow('HTTP 404');
    });
  });

  describe('POST /runs/:runId/tools/:toolCallId/reject', () => {
    it('rejects a pending tool with reason', async () => {
      const approvalRepo = TestDataSource.getRepository(ToolApproval);
      await approvalRepo.save({
        run_id: runId,
        tool_call_id: 'reject-test-tool',
        tool_name: 'shell_command',
        args: { command: 'rm -rf /' },
        step_number: 1,
        status: 'pending',
      });

      const response = await client.post(
        `/runs/${runId}/tools/reject-test-tool/reject`,
        { reason: 'Too dangerous' }
      );
      expect(response.success).toBe(true);
      expect(response.status).toBe('rejected');
    });
  });

  describe('GET /runs/:runId/approvals', () => {
    it('returns all approvals for a run', async () => {
      const approvalRepo = TestDataSource.getRepository(ToolApproval);
      await approvalRepo.save([
        {
          run_id: runId,
          tool_call_id: 'tool-1',
          tool_name: 'read_file',
          args: {},
          step_number: 1,
          status: 'approved',
        },
        {
          run_id: runId,
          tool_call_id: 'tool-2',
          tool_name: 'write_file',
          args: {},
          step_number: 2,
          status: 'rejected',
          rejection_reason: 'Not allowed',
        },
      ]);

      const response = await client.get(`/runs/${runId}/approvals`);
      expect(response.approvals.length).toBe(2);
    });
  });
});
