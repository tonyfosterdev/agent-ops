/**
 * ApprovalService - Simple DB operations for tool approvals
 *
 * No blocking, no Promises, no EventEmitters.
 * Just create/update/query approval records.
 */

import { AppDataSource } from '../database.js';
import { ToolApproval, type ApprovalStatus } from '../entities/ToolApproval.js';
import { logger } from '../config.js';

export class ApprovalService {
  private repository = AppDataSource.getRepository(ToolApproval);

  /**
   * Create a pending approval record
   */
  async createApproval(request: {
    runId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    stepNumber: number;
  }): Promise<ToolApproval> {
    const approval = this.repository.create({
      run_id: request.runId,
      tool_call_id: request.toolCallId,
      tool_name: request.toolName,
      args: request.args,
      step_number: request.stepNumber,
      status: 'pending' as ApprovalStatus,
    });
    return this.repository.save(approval);
  }

  /**
   * Approve a pending tool call
   */
  async approve(runId: string, toolCallId: string): Promise<boolean> {
    const approval = await this.repository.findOne({
      where: { run_id: runId, tool_call_id: toolCallId, status: 'pending' as ApprovalStatus },
    });

    if (!approval) {
      logger.warn({ runId, toolCallId }, 'Cannot approve: not found or not pending');
      return false;
    }

    await this.repository.update(approval.id, {
      status: 'approved' as ApprovalStatus,
      resolved_at: new Date(),
    });

    logger.info({ runId, toolCallId, toolName: approval.tool_name }, 'Tool approved');
    return true;
  }

  /**
   * Reject a pending tool call
   */
  async reject(runId: string, toolCallId: string, reason?: string): Promise<boolean> {
    const approval = await this.repository.findOne({
      where: { run_id: runId, tool_call_id: toolCallId, status: 'pending' as ApprovalStatus },
    });

    if (!approval) {
      logger.warn({ runId, toolCallId }, 'Cannot reject: not found or not pending');
      return false;
    }

    await this.repository.update(approval.id, {
      status: 'rejected' as ApprovalStatus,
      rejection_reason: reason,
      resolved_at: new Date(),
    });

    logger.info({ runId, toolCallId, toolName: approval.tool_name, reason }, 'Tool rejected');
    return true;
  }

  /**
   * Get the current pending approval for a run (if any)
   */
  async getPendingApproval(runId: string): Promise<ToolApproval | null> {
    return this.repository.findOne({
      where: { run_id: runId, status: 'pending' as ApprovalStatus },
    });
  }

  /**
   * Get approval by tool call ID within a run
   */
  async getByToolCallId(runId: string, toolCallId: string): Promise<ToolApproval | null> {
    return this.repository.findOne({
      where: { run_id: runId, tool_call_id: toolCallId },
    });
  }

  /**
   * Get all approvals for a run
   */
  async getApprovalsForRun(runId: string): Promise<ToolApproval[]> {
    return this.repository.find({
      where: { run_id: runId },
      order: { created_at: 'ASC' },
    });
  }
}
