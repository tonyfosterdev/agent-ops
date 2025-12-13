import { EventEmitter } from 'events';
import { AppDataSource } from '../database.js';
import { ToolApproval, type ApprovalStatus } from '../entities/ToolApproval.js';
import { logger } from '../config.js';

export interface ApprovalRequest {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  stepNumber: number;
}

export interface ApprovalResult {
  status: 'approved' | 'rejected' | 'timeout';
  rejectionReason?: string;
}

// Global event emitter for approval signals
// Used for immediate notification when approval status changes
const approvalEmitter = new EventEmitter();
approvalEmitter.setMaxListeners(100);

export class ApprovalService {
  private repository = AppDataSource.getRepository(ToolApproval);

  /**
   * Create a pending approval request and wait for resolution.
   * This method BLOCKS until the approval is resolved (approved, rejected, or timeout).
   */
  async requestApproval(
    request: ApprovalRequest,
    timeoutMs: number = 300000 // 5 minute default
  ): Promise<ApprovalResult> {
    // Create approval record in pending state
    const approval = this.repository.create({
      run_id: request.runId,
      tool_call_id: request.toolCallId,
      tool_name: request.toolName,
      args: request.args,
      step_number: request.stepNumber,
      status: 'pending' as ApprovalStatus,
    });
    const saved = await this.repository.save(approval);

    logger.info(
      { approvalId: saved.id, runId: request.runId, toolName: request.toolName },
      'Approval request created, waiting for resolution'
    );

    // Wait for approval via event or polling
    return new Promise<ApprovalResult>((resolve) => {
      const eventKey = `approval:${saved.id}`;
      let resolved = false;

      const cleanup = () => {
        approvalEmitter.removeListener(eventKey, onApproval);
        clearTimeout(timeoutId);
        clearInterval(pollId);
      };

      const onApproval = (result: ApprovalResult) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          logger.info(
            { approvalId: saved.id, status: result.status },
            'Approval resolved via event'
          );
          resolve(result);
        }
      };

      // Listen for event-based resolution (immediate)
      approvalEmitter.once(eventKey, onApproval);

      // Timeout handler
      const timeoutId = setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          await this.repository.update(saved.id, {
            status: 'timeout' as ApprovalStatus,
            resolved_at: new Date(),
          });
          logger.warn(
            { approvalId: saved.id, timeoutMs },
            'Approval timed out'
          );
          resolve({ status: 'timeout' });
        }
      }, timeoutMs);

      // Fallback polling (in case event is missed, e.g., server restart)
      const pollId = setInterval(async () => {
        if (resolved) return;
        try {
          const current = await this.repository.findOne({
            where: { id: saved.id },
          });
          if (current && current.status !== 'pending') {
            resolved = true;
            cleanup();
            logger.info(
              { approvalId: saved.id, status: current.status },
              'Approval resolved via polling'
            );
            resolve({
              status: current.status as 'approved' | 'rejected',
              rejectionReason: current.rejection_reason ?? undefined,
            });
          }
        } catch (error) {
          logger.error({ error, approvalId: saved.id }, 'Error polling approval status');
        }
      }, 1000);
    });
  }

  /**
   * Approve a pending tool call.
   */
  async approve(approvalId: string): Promise<boolean> {
    const approval = await this.repository.findOne({
      where: { id: approvalId, status: 'pending' as ApprovalStatus },
    });

    if (!approval) {
      logger.warn({ approvalId }, 'Cannot approve: approval not found or not pending');
      return false;
    }

    await this.repository.update(approvalId, {
      status: 'approved' as ApprovalStatus,
      resolved_at: new Date(),
    });

    // Emit event to wake up waiting request
    approvalEmitter.emit(`approval:${approvalId}`, { status: 'approved' });

    logger.info(
      { approvalId, runId: approval.run_id, toolName: approval.tool_name },
      'Tool approved'
    );
    return true;
  }

  /**
   * Reject a pending tool call.
   */
  async reject(approvalId: string, reason?: string): Promise<boolean> {
    const approval = await this.repository.findOne({
      where: { id: approvalId, status: 'pending' as ApprovalStatus },
    });

    if (!approval) {
      logger.warn({ approvalId }, 'Cannot reject: approval not found or not pending');
      return false;
    }

    await this.repository.update(approvalId, {
      status: 'rejected' as ApprovalStatus,
      rejection_reason: reason,
      resolved_at: new Date(),
    });

    // Emit event to wake up waiting request
    approvalEmitter.emit(`approval:${approvalId}`, {
      status: 'rejected',
      rejectionReason: reason,
    });

    logger.info(
      { approvalId, runId: approval.run_id, toolName: approval.tool_name, reason },
      'Tool rejected'
    );
    return true;
  }

  /**
   * Get the current pending approval for a run (if any).
   */
  async getPendingApproval(runId: string): Promise<ToolApproval | null> {
    return this.repository.findOne({
      where: { run_id: runId, status: 'pending' as ApprovalStatus },
    });
  }

  /**
   * Get approval by tool call ID within a run.
   */
  async getByToolCallId(runId: string, toolCallId: string): Promise<ToolApproval | null> {
    return this.repository.findOne({
      where: { run_id: runId, tool_call_id: toolCallId },
    });
  }

  /**
   * Get all approvals for a run.
   */
  async getApprovalsForRun(runId: string): Promise<ToolApproval[]> {
    return this.repository.find({
      where: { run_id: runId },
      order: { created_at: 'ASC' },
    });
  }
}
