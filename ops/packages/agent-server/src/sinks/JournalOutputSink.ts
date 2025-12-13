import type { OutputSink } from './OutputSink.js';
import type { JournalService } from '../services/JournalService.js';
import { ApprovalService } from '../services/ApprovalService.js';

/**
 * OutputSink implementation that writes to the database journal.
 * Manages heartbeat internally to indicate "thinking" state.
 */
export class JournalOutputSink implements OutputSink {
  private runId: string;
  private journal: JournalService;
  private startTime: number;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private approvalService: ApprovalService;

  constructor(runId: string, journal: JournalService) {
    this.runId = runId;
    this.journal = journal;
    this.startTime = Date.now();
    this.approvalService = new ApprovalService();
  }

  async writeRunStarted(data: {
    task: string;
    maxSteps: number;
    agentType: string;
  }): Promise<void> {
    await this.journal.writeEntry(this.runId, 'run:started', data);
    this.startHeartbeat();
  }

  async writeThinking(elapsedMs: number): Promise<void> {
    await this.journal.writeEntry(this.runId, 'thinking', {
      elapsed_ms: elapsedMs,
    });
  }

  async writeText(text: string, stepNumber: number): Promise<void> {
    await this.journal.writeEntry(this.runId, 'text', { text }, stepNumber);
  }

  async writeToolPendingApproval(
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
    stepNumber: number
  ): Promise<{ approved: boolean; rejectionReason?: string }> {
    // Stop heartbeat while waiting for approval
    this.stopHeartbeat();

    // Write pending approval entry to journal (will be sent via SSE)
    await this.journal.writeEntry(
      this.runId,
      'tool:pending_approval',
      { toolName, toolCallId, args },
      stepNumber
    );

    // Block until approval is received (or timeout)
    const result = await this.approvalService.requestApproval({
      runId: this.runId,
      toolCallId,
      toolName,
      args,
      stepNumber,
    });

    // Write resolution entry
    if (result.status === 'approved') {
      await this.journal.writeEntry(
        this.runId,
        'tool:approved',
        { toolName, toolCallId },
        stepNumber
      );
      // Restart heartbeat for continued execution
      this.startHeartbeat();
      return { approved: true };
    } else {
      await this.journal.writeEntry(
        this.runId,
        'tool:rejected',
        { toolName, toolCallId, reason: result.rejectionReason },
        stepNumber
      );
      return { approved: false, rejectionReason: result.rejectionReason };
    }
  }

  async writeToolStarting(
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
    stepNumber: number
  ): Promise<void> {
    this.stopHeartbeat();
    await this.journal.writeEntry(
      this.runId,
      'tool:starting',
      { toolName, toolCallId, args },
      stepNumber
    );
  }

  async writeToolComplete(
    toolName: string,
    toolCallId: string,
    result: unknown,
    success: boolean,
    summary: string,
    stepNumber: number
  ): Promise<void> {
    await this.journal.writeEntry(
      this.runId,
      'tool:complete',
      { toolName, toolCallId, result, success, summary },
      stepNumber
    );
  }

  async writeStepComplete(stepNumber: number): Promise<void> {
    await this.journal.writeEntry(this.runId, 'step:complete', {}, stepNumber);
    this.startHeartbeat();
  }

  async writeRunComplete(result: {
    success: boolean;
    message: string;
    steps: number;
  }): Promise<void> {
    this.stopHeartbeat();
    await this.journal.writeEntry(this.runId, 'run:complete', result);
    await this.journal.completeRun(this.runId, result);
  }

  async writeRunError(error: string): Promise<void> {
    this.stopHeartbeat();
    await this.journal.writeEntry(this.runId, 'run:error', { error });
    await this.journal.failRun(this.runId, error);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.writeThinking(Date.now() - this.startTime);
      } catch {
        // Ignore heartbeat errors - non-critical
      }
    }, 2000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
