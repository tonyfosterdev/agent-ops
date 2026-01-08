/**
 * Shell execution tools for AgentKit.
 *
 * These are dangerous tools that require human approval (HITL)
 * before execution. The tool uses Inngest's step.waitForEvent()
 * to pause execution until approval is received.
 *
 * ## Factory Pattern
 *
 * Tools are created via factory functions that receive a publish function.
 * This allows tools to emit hitl.requested events before waiting for approval.
 *
 * ```typescript
 * const shellTool = createShellExecuteTool({ publish });
 * ```
 *
 * ## HITL Event Correlation Pattern
 *
 * 1. Tool generates a unique toolCallId in step.run() - this is durable
 * 2. Tool publishes hitl.requested event via publish() - dashboard shows approval UI
 * 3. Tool waits for 'agentops/tool.approval' event with if: 'async.data.toolCallId == "${toolCallId}"'
 * 4. User clicks Approve/Deny, which calls approveToolCall(toolCallId) or denyToolCall(toolCallId, reason)
 * 5. The server sends the approval event to Inngest with the matching toolCallId
 * 6. waitForEvent resolves and execution continues
 *
 * The toolCallId approach (vs runId) allows multiple tool calls per run to be
 * independently approved/rejected.
 *
 * ## Defense-in-Depth
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
import type { FactoryContext } from './types.js';
import { createHitlRequestedEvent, createHitlResolvedEvent } from './types.js';

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
 * Create a shell command execution tool.
 *
 * This tool is considered dangerous because shell commands can
 * modify system state, delete files, or execute arbitrary code.
 *
 * The tool handler:
 * 1. Validates command against allowlist (defense-in-depth)
 * 2. Generates a unique toolCallId for tracking (durably via step.run)
 * 3. Publishes hitl.requested event for dashboard
 * 4. Waits for human approval via step.waitForEvent()
 * 5. If approved, executes the command wrapped in step.run() for durability
 * 6. If rejected, returns an error with optional feedback
 *
 * @param context - Factory context with publish function
 * @returns Configured shell execute tool
 */
export function createShellExecuteTool({ publish }: FactoryContext) {
  return createTool({
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

      // Generate a unique toolCallId for this tool invocation DURABLY
      // This MUST be inside step.run() to ensure the same ID is used if the function
      // restarts between generating the ID and completing waitForEvent.
      // Without this, a restart would generate a new ID and break approval correlation.
      // Use unique step ID based on input hash to avoid collisions when tool is called multiple times
      const inputHash = crypto
        .createHash('md5')
        .update(JSON.stringify({ command, workingDirectory }))
        .digest('hex')
        .slice(0, 8);
      const toolCallId = await step.run(`generate-shell-tool-id-${inputHash}`, () =>
        crypto.randomUUID()
      );

      // Get runId from network state for HITL event correlation
      const runId = (network?.state?.kv?.get('runId') as string) || 'unknown';

      // Publish HITL request - dashboard will show approval button
      // Wrapped in step.run for durability (won't republish on function restart)
      try {
        await step.run(`publish-hitl-${toolCallId}`, async () => {
          await publish(
            createHitlRequestedEvent({
              requestId: toolCallId,
              runId,
              toolCalls: [
                {
                  partId: toolCallId,
                  toolName: 'shell_command_execute',
                  toolInput: { command, reason, workingDirectory },
                },
              ],
              expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
              metadata: { reason, riskLevel: 'high' },
            })
          );
        });
      } catch (publishError) {
        console.error('Failed to publish HITL event:', publishError);
        // Continue - waitForEvent will still work, just no dashboard notification
      }

      // Wait for human approval (4 hour timeout)
      // The approval event must include the toolCallId in its data
      // Using dynamic step ID to avoid collisions if tool is called multiple times
      // NOTE: We use 'if' instead of 'match' because 'match' compares against the
      // triggering event (agent/chat) which doesn't have toolCallId. The 'if'
      // expression filters incoming events by their data.toolCallId field.
      const approval = await step
        .waitForEvent(`wait-for-shell-approval-${toolCallId}`, {
          event: 'agentops/tool.approval',
          if: `async.data.toolCallId == "${toolCallId}"`,
          timeout: '4h',
        })
        .catch((err: Error) => {
          // Handle timeout gracefully - treat as rejection
          if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
            return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
          }
          throw err;
        });

      // Publish resolution event so dashboard knows the request was handled
      // Must be wrapped in step.run for durability
      try {
        await step.run(`publish-hitl-resolved-${toolCallId}`, async () => {
          await publish(
            createHitlResolvedEvent({
              requestId: toolCallId,
              runId,
              resolution: approval?.data.approved ? 'approved' : 'denied',
              resolvedAt: new Date().toISOString(),
            })
          );
        });
      } catch (publishError) {
        console.error('Failed to publish HITL resolved event:', publishError);
        // Continue - this is informational, not blocking
      }

      // Check if approval was received and granted
      if (!approval || !approval.data.approved) {
        const feedback = approval?.data?.feedback;
        return {
          status: 'rejected' as const,
          error: 'Command rejected by human',
          feedback,
          command,
          reason,
          toolCallId,
        };
      }

      // Execute the command with durability via step.run()
      // Using dynamic step ID to avoid collisions
      const executionResult = await step.run(`execute-shell-command-${toolCallId}`, async () => {
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
            success: false,
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

      return executionResult;
    },
  });
}

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
 * Create all shell tools with publish function injected.
 *
 * @param context - Factory context with publish function
 * @returns Array of shell tools
 */
export function createShellTools(context: FactoryContext) {
  return [createShellExecuteTool(context)];
}
