/**
 * Delegation Tools for Hierarchical Multi-Agent System
 *
 * Sequential delegation tools that create and wait for child runs.
 * Uses lazy imports to avoid circular dependencies.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { journalService } from '../services/JournalService';
import type { ToolContext, AgentType } from '../agents/types';
import { logger } from '../config';

// ============================================
// Constants
// ============================================

// Timeouts for child run execution
const CHILD_RUN_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CHILD_HITL_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes for HITL approval

// Polling intervals
const CHILD_COMPLETION_POLL_INTERVAL_MS = 500; // Poll every 500ms for child completion
const HITL_WAIT_POLL_INTERVAL_MS = 1000; // Poll every 1s for HITL (less frequent)

/**
 * Create tool for delegating to coding agent
 */
export function createRunCodingAgentTool(ctx: ToolContext) {
  return tool({
    description: 'Delegate a debugging/coding task to the coding agent. Waits for completion.',
    parameters: z.object({
      task: z.string().describe('The task for the coding agent'),
    }),
    execute: async ({ task }) => {
      return await executeChildRun(ctx, 'coding', task);
    },
  });
}

/**
 * Create tool for delegating to log analyzer agent
 */
export function createRunLogAnalyzerTool(ctx: ToolContext) {
  return tool({
    description: 'Delegate a log analysis task to the log analyzer agent. Waits for completion.',
    parameters: z.object({
      task: z.string().describe('The task for the log analyzer agent'),
    }),
    execute: async ({ task }) => {
      return await executeChildRun(ctx, 'log-analyzer', task);
    },
  });
}

/**
 * Execute a child run and wait for completion
 */
async function executeChildRun(
  ctx: ToolContext,
  agentType: AgentType,
  task: string
): Promise<{ success: boolean; child_run_id: string; summary: string }> {
  // Prevent orchestrator delegating to orchestrator (depth limit)
  if (agentType === 'orchestrator') {
    throw new Error('Cannot delegate to orchestrator - only coding and log-analyzer agents allowed');
  }

  logger.info({ parentRunId: ctx.runId, agentType, task }, 'Starting child run delegation');

  // Get parent run info
  const parentRun = await journalService.getRun(ctx.runId);
  if (!parentRun) {
    throw new Error('Parent run not found');
  }

  // Create child run
  const childRunId = await journalService.createChildRun(
    task,
    parentRun.user_id,
    ctx.runId,
    agentType
  );

  // Record in parent journal
  await journalService.appendEvent(ctx.runId, {
    type: 'CHILD_RUN_STARTED',
    payload: { child_run_id: childRunId, agent_type: agentType, task },
  });

  try {
    // Lazy import to break circular dependency
    const { runAgentStep } = await import('../services/DurableLoop.js');

    // Execute child run (uses same DurableLoop!)
    // Note: Timeout is handled in waitForChildCompletion, not here
    await runAgentStep(childRunId);

    // Wait for child completion (handles HITL by suspending parent too)
    const result = await waitForChildCompletion(ctx.runId, childRunId);

    // Record completion in parent
    await journalService.appendEvent(ctx.runId, {
      type: 'CHILD_RUN_COMPLETED',
      payload: {
        child_run_id: childRunId,
        success: result.success,
        summary: result.summary,
      },
    });

    logger.info(
      { parentRunId: ctx.runId, childRunId, success: result.success },
      'Child run delegation completed'
    );

    return { success: result.success, child_run_id: childRunId, summary: result.summary };
  } catch (error) {
    // Record failure in parent
    await journalService.appendEvent(ctx.runId, {
      type: 'CHILD_RUN_COMPLETED',
      payload: {
        child_run_id: childRunId,
        success: false,
        summary: `Child run failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    });

    throw error;
  }
}

/**
 * Wait for child run to complete (handles HITL suspension)
 */
async function waitForChildCompletion(
  parentRunId: string,
  childRunId: string
): Promise<{ success: boolean; summary: string }> {
  const startTime = Date.now();
  let lastStatus: string | undefined;

  while (true) {
    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed > CHILD_RUN_TIMEOUT_MS) {
      throw new Error(`Child run timed out after ${CHILD_RUN_TIMEOUT_MS / 1000}s`);
    }

    const run = await journalService.getRun(childRunId);
    if (!run) {
      throw new Error('Child run not found');
    }

    // Log status changes
    if (run.status !== lastStatus) {
      logger.debug(
        { parentRunId, childRunId, status: run.status },
        'Child run status changed'
      );
      lastStatus = run.status;
    }

    // Check if completed or failed
    if (run.status === 'completed' || run.status === 'failed') {
      const events = await journalService.getEvents(childRunId);
      const completed = events.find((e) => e.event_type === 'RUN_COMPLETED');
      const summary = completed
        ? (completed.payload as { summary: string }).summary
        : 'No summary available';
      return { success: run.status === 'completed', summary };
    }

    // If child is suspended (HITL), suspend parent too
    if (run.status === 'suspended') {
      const parentRun = await journalService.getRun(parentRunId);
      if (parentRun && parentRun.status !== 'suspended') {
        // Get child run to capture agent type
        const childRun = await journalService.getRun(childRunId);
        const childAgentType = childRun?.agent_type;

        logger.info(
          { parentRunId, childRunId, childAgentType },
          'Suspending parent run while child awaits HITL approval'
        );

        await journalService.appendEvent(parentRunId, {
          type: 'RUN_SUSPENDED',
          payload: {
            reason: `Waiting for child run approval`,
            blocked_by_child_run_id: childRunId,
            child_agent_type: childAgentType,
          },
        });
        await journalService.updateStatus(parentRunId, 'suspended');
      }

      // Wait for child to reach a terminal state or resume to running
      const childTerminalStatus = await waitForChildTerminalOrRunning(childRunId);

      // Only resume parent if child has reached terminal state
      // If child is running again, we'll continue polling
      if (childTerminalStatus === 'completed' || childTerminalStatus === 'failed') {
        const currentParent = await journalService.getRun(parentRunId);
        if (currentParent && currentParent.status === 'suspended') {
          logger.info({ parentRunId }, 'Resuming parent run after child completion');
          // Record RUN_RESUMED event for journal completeness
          await journalService.appendEvent(parentRunId, {
            type: 'RUN_RESUMED',
            payload: {
              decision: 'approved', // Auto-approved because child completed
              feedback: `Child run ${childRunId} completed`,
            },
          });
          await journalService.updateStatus(parentRunId, 'running');
        }
      }

      continue; // Re-check child status
    }

    // Poll for child completion
    await new Promise((resolve) => setTimeout(resolve, CHILD_COMPLETION_POLL_INTERVAL_MS));
  }
}

/**
 * Wait for child run to reach a terminal state or resume to running
 * Returns the final status when child is no longer suspended
 */
async function waitForChildTerminalOrRunning(childRunId: string): Promise<string> {
  const startTime = Date.now();

  while (true) {
    // Check HITL timeout (longer than execution timeout)
    const elapsed = Date.now() - startTime;
    if (elapsed > CHILD_HITL_TIMEOUT_MS) {
      throw new Error(
        `Child run HITL approval timed out after ${CHILD_HITL_TIMEOUT_MS / 1000}s`
      );
    }

    const run = await journalService.getRun(childRunId);
    if (!run) {
      throw new Error('Child run not found during resume wait');
    }

    // Return status when child is no longer suspended
    if (run.status !== 'suspended') {
      return run.status;
    }

    // Poll for HITL approval (less frequent)
    await new Promise((resolve) => setTimeout(resolve, HITL_WAIT_POLL_INTERVAL_MS));
  }
}
