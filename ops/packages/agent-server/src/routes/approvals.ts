import { Hono } from 'hono';
import { ApprovalService } from '../services/ApprovalService.js';
import { logger } from '../config.js';

const app = new Hono();
const approvalService = new ApprovalService();

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

  const success = await approvalService.approve(approval.id);

  if (!success) {
    return c.json({ error: 'Failed to approve' }, 500);
  }

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

  const success = await approvalService.reject(approval.id, reason);

  if (!success) {
    return c.json({ error: 'Failed to reject' }, 500);
  }

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
