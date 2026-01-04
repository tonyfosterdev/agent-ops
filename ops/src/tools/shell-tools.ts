/**
 * Shell execution tools for AgentKit.
 *
 * These are dangerous tools that require human approval (HITL)
 * before execution. The tool uses Inngest's step.waitForEvent()
 * to pause execution until approval is received.
 *
 * HITL Event Correlation Pattern:
 *
 * 1. Tool generates a unique toolCallId in step.run() - this is durable
 * 2. Tool waits for 'agentops/tool.approval' event with match: 'data.toolCallId'
 * 3. The useAgent hook on the frontend shows pending tool calls in the message stream
 * 4. User clicks Approve/Deny, which calls approveToolCall(toolCallId) or denyToolCall(toolCallId, reason)
 * 5. The hook sends the approval event to Inngest with the matching toolCallId
 * 6. waitForEvent resolves and execution continues
 *
 * The toolCallId approach (vs runId) allows multiple tool calls per run to be
 * independently approved/rejected.
 *
 * Defense-in-Depth:
 *
 * Commands are validated against an allowlist BEFORE being sent for HITL approval.
 * This prevents obviously dangerous commands from even reaching the approval queue.
 * The allowlist is defined in security.ts and includes common safe commands.
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { validateCommand } from './security.js';

/**
 * Result type for HITL tools that require approval.
 */
export interface HitlPendingResult {
  status: 'requires_approval';
  toolCallId: string;
  tool: string;
  request: Record<string, unknown>;
  metadata?: {
    reason?: string;
    riskLevel?: 'low' | 'medium' | 'high';
  };
}

/**
 * Execute a shell command.
 *
 * This tool is considered dangerous because shell commands can
 * modify system state, delete files, or execute arbitrary code.
 *
 * The tool handler:
 * 1. Generates a unique toolCallId for tracking
 * 2. Waits for human approval via step.waitForEvent()
 * 3. If approved, executes the command wrapped in step.run() for durability
 * 4. If rejected, returns an error with optional feedback
 */
export const shellExecuteTool = createTool({
  name: 'shell_command_execute',
  description:
    'Execute a shell command. This is a dangerous operation that requires human approval. Provide a clear reason why the command needs to run.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    reason: z
      .string()
      .describe('Clear explanation of why this command needs to be run'),
    workingDirectory: z
      .string()
      .optional()
      .describe('Working directory for command execution (defaults to current directory)'),
    timeout: z
      .number()
      .optional()
      .default(30000)
      .describe('Command timeout in milliseconds (default: 30000ms)'),
  }),
  handler: async ({ command, reason, workingDirectory, timeout }, { step, network }) => {
    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return {
        error: 'Step context not available - tool must be run within Inngest function',
        command,
        toolCallId: 'unavailable',
      };
    }

    // Validate command against allowlist BEFORE waiting for approval
    // This provides defense-in-depth by rejecting obviously dangerous commands
    const validation = validateCommand(command);
    if (!validation.valid) {
      return {
        success: false,
        error: 'Command validation failed',
        reason: validation.reason,
        command,
        toolCallId: 'validation-failed',
      };
    }

    // Generate toolCallId in a durable step FIRST so it's recorded and visible
    // in the Inngest UI before we wait for approval. This allows the frontend
    // to discover pending approvals by inspecting step output.
    const toolCallId = await step.run('generate-tool-call-id', () => crypto.randomUUID());

    // Wait for human approval (4 hour timeout)
    // The approval event must include the toolCallId in its data
    // Using dynamic step ID to avoid collisions if tool is called multiple times
    const approval = await step.waitForEvent(`wait-for-shell-approval-${toolCallId}`, {
      event: 'agentops/tool.approval',
      match: 'data.toolCallId',
      timeout: '4h',
    }).catch((err: Error) => {
      // Handle timeout gracefully - treat as rejection
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
      }
      throw err;
    });

    // Check if approval was received and granted
    if (!approval || !approval.data.approved) {
      return {
        status: 'rejected',
        error: 'Command rejected by human',
        feedback: approval?.data?.feedback,
        command,
        reason,
        toolCallId,
      };
    }

    // Execute the command with durability via step.run()
    // Using dynamic step ID to avoid collisions
    return step.run(`execute-shell-command-${toolCallId}`, async () => {
      try {
        const options: {
          encoding: 'utf-8';
          timeout: number;
          cwd?: string;
          maxBuffer: number;
        } = {
          encoding: 'utf-8',
          timeout: timeout ?? 30000,
          maxBuffer: 10 * 1024 * 1024, // 10MB output buffer
        };

        if (workingDirectory) {
          options.cwd = workingDirectory;
        }

        const output = execSync(command, options);

        return {
          success: true,
          command,
          output: output.toString(),
          toolCallId,
        };
      } catch (err) {
        const error = err as Error & {
          status?: number;
          stderr?: string;
          stdout?: string;
        };

        return {
          error: 'Command execution failed',
          message: error.message,
          exitCode: error.status,
          stderr: error.stderr,
          stdout: error.stdout,
          command,
          toolCallId,
        };
      }
    });
  },
});

/**
 * Metadata for dangerous tools, used by the agent layer
 * to determine which tools require HITL approval.
 */
export const shellToolMetadata = {
  shell_command_execute: {
    requiresApproval: true,
    riskLevel: 'high' as const,
    description: 'Executes arbitrary shell commands',
  },
};

/**
 * All shell tools as an array for convenient registration.
 */
export const shellTools = [shellExecuteTool];
