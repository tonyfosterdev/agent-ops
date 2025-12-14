import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { JournalService } from '../services/JournalService.js';
import { ApprovalService } from '../services/ApprovalService.js';
import { agentRunner } from '../services/AgentRunner.js';
import { logger } from '../config.js';

const app = new Hono();
const approvalService = new ApprovalService();

/**
 * GET /runs/:runId
 * Get run details with journal entries
 */
app.get('/:runId', async (c) => {
  const journalService = new JournalService();

  const runId = c.req.param('runId');
  const run = await journalService.getRunWithOrderedEntries(runId);

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  return c.json({
    run: {
      id: run.id,
      sessionId: run.session_id,
      runNumber: run.run_number,
      agentType: run.agent_type,
      task: run.task,
      status: run.status,
      config: run.config,
      result: run.result,
      contextSummary: run.context_summary,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      createdAt: run.created_at,
    },
    entries: run.entries.map((entry) => ({
      id: entry.id,
      entryType: entry.entry_type,
      stepNumber: entry.step_number,
      data: entry.data,
      createdAt: entry.created_at,
    })),
  });
});

/**
 * GET /runs/:runId/subscribe
 * Subscribe to run updates via Server-Sent Events
 */
app.get('/:runId/subscribe', async (c) => {
  const journalService = new JournalService();

  const runId = c.req.param('runId');
  const run = await journalService.getRun(runId);

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  logger.info({ runId }, 'Client subscribing to run updates');

  return stream(c, async (stream) => {
    let lastSequence = 0;
    let isComplete = false;
    let pollCount = 0;
    const maxPollTime = 10 * 60 * 1000; // 10 minutes max
    const startTime = Date.now();

    // Poll for new entries
    while (!isComplete) {
      const entries = await journalService.getEntriesSince(runId, lastSequence);

      for (const entry of entries) {
        // Build base event data
        const eventData: Record<string, unknown> = {
          type: 'entry',
          entry: {
            id: entry.id,
            entry_type: entry.entry_type,
            step_number: entry.step_number,
            data: entry.data,
            created_at: entry.created_at,
          },
        };

        // Add action hints for approval-required entries
        if (entry.entry_type === 'tool:pending_approval') {
          const toolCallId = (entry.data as { toolCallId?: string })?.toolCallId;
          eventData.requiresAction = true;
          eventData.actionEndpoints = {
            approve: `/runs/${runId}/tools/${toolCallId}/approve`,
            reject: `/runs/${runId}/tools/${toolCallId}/reject`,
          };
        }

        await stream.writeln(`data: ${JSON.stringify(eventData)}`);

        lastSequence = entry.sequence_number;

        // Check for completion entries
        if (entry.entry_type === 'run:complete' || entry.entry_type === 'run:error') {
          isComplete = true;
        }
      }

      if (!isComplete) {
        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, 100));
        pollCount++;

        // Periodically check if run status changed (every 10 polls)
        if (pollCount % 10 === 0) {
          const currentRun = await journalService.getRun(runId);
          if (currentRun?.status === 'completed' || currentRun?.status === 'failed') {
            isComplete = true;
          }
        }

        // Timeout safety
        if (Date.now() - startTime > maxPollTime) {
          logger.warn({ runId }, 'SSE subscription timed out');
          isComplete = true;
        }
      }
    }

    // Send final complete event
    const finalRun = await journalService.getRun(runId);
    await stream.writeln(
      `data: ${JSON.stringify({
        type: 'complete',
        run: {
          id: finalRun?.id,
          status: finalRun?.status,
          result: finalRun?.result,
        },
      })}`
    );

    logger.info({ runId }, 'SSE subscription completed');
  });
});

/**
 * GET /runs/:runId/pending-approval
 * Get the current pending approval for a run (if any)
 */
app.get('/:runId/pending-approval', async (c) => {
  const runId = c.req.param('runId');

  const approval = await approvalService.getPendingApproval(runId);

  if (!approval) {
    return c.json({ pending: false });
  }

  return c.json({
    pending: true,
    approval: {
      id: approval.id,
      toolName: approval.tool_name,
      toolCallId: approval.tool_call_id,
      args: approval.args,
      stepNumber: approval.step_number,
      createdAt: approval.created_at,
    },
  });
});

/**
 * POST /runs/:runId/tools/:toolCallId/approve
 * Approve a pending tool call
 */
app.post('/:runId/tools/:toolCallId/approve', async (c) => {
  const runId = c.req.param('runId');
  const toolCallId = c.req.param('toolCallId');

  logger.info({ runId, toolCallId }, 'Tool approval request received');

  const approval = await approvalService.getByToolCallId(runId, toolCallId);

  if (!approval) {
    return c.json({ error: 'Approval request not found' }, 404);
  }

  if (approval.status !== 'pending') {
    return c.json(
      { error: 'Approval already resolved', status: approval.status },
      400
    );
  }

  const success = await approvalService.approve(runId, toolCallId);

  if (!success) {
    return c.json({ error: 'Failed to approve' }, 500);
  }

  // Resume agent execution in background
  agentRunner.resume(runId).catch((error) => {
    logger.error({ error: error.message, runId }, 'Failed to resume agent after approval');
  });

  return c.json({ success: true, status: 'approved' });
});

/**
 * POST /runs/:runId/tools/:toolCallId/reject
 * Reject a pending tool call
 */
app.post('/:runId/tools/:toolCallId/reject', async (c) => {
  const runId = c.req.param('runId');
  const toolCallId = c.req.param('toolCallId');

  let body: { reason?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // No body is fine
  }
  const reason = body.reason;

  logger.info({ runId, toolCallId, reason }, 'Tool rejection request received');

  const approval = await approvalService.getByToolCallId(runId, toolCallId);

  if (!approval) {
    return c.json({ error: 'Approval request not found' }, 404);
  }

  if (approval.status !== 'pending') {
    return c.json(
      { error: 'Approval already resolved', status: approval.status },
      400
    );
  }

  const success = await approvalService.reject(runId, toolCallId, reason);

  if (!success) {
    return c.json({ error: 'Failed to reject' }, 500);
  }

  // Resume agent execution in background (agent will see rejection)
  agentRunner.resume(runId).catch((error) => {
    logger.error({ error: error.message, runId }, 'Failed to resume agent after rejection');
  });

  return c.json({ success: true, status: 'rejected' });
});

/**
 * GET /runs/:runId/approvals
 * Get all approvals for a run (for debugging/history)
 */
app.get('/:runId/approvals', async (c) => {
  const runId = c.req.param('runId');

  const approvals = await approvalService.getApprovalsForRun(runId);

  return c.json({
    approvals: approvals.map((a) => ({
      id: a.id,
      toolName: a.tool_name,
      toolCallId: a.tool_call_id,
      args: a.args,
      stepNumber: a.step_number,
      status: a.status,
      rejectionReason: a.rejection_reason,
      resolvedAt: a.resolved_at,
      createdAt: a.created_at,
    })),
  });
});

export default app;
