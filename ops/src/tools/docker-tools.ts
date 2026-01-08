/**
 * Docker Compose tools for AgentKit.
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
 * const dockerTool = createDockerComposeRestartTool({ publish });
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
 * ## Defense-in-Depth
 *
 * Service names are validated against an allowlist BEFORE being sent for HITL approval.
 * This prevents unauthorized service restarts from even reaching the approval queue.
 * The allowlist is defined in security.ts and includes only safe services.
 *
 * ## Post-Restart Health Check
 *
 * After restarting a service, the tool verifies the container is actually running
 * by checking `docker compose ps`. This ensures the restart was successful and
 * the service is healthy, not just that the restart command exited.
 *
 * ## Output Truncation
 *
 * Docker build output can be very large (10MB+). The tool truncates output to
 * the last 100 lines to avoid overwhelming the LLM context.
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import {
  validateServiceRestart,
  ALLOWED_SERVICES,
  getComposeFilePath,
  getComposeProjectName,
} from './security.js';
import type { FactoryContext } from './types.js';
import { createHitlRequestedEvent, createHitlResolvedEvent } from './types.js';

/**
 * Maximum number of lines to return from docker output.
 * This prevents overwhelming the LLM with massive build logs.
 */
const MAX_OUTPUT_LINES = 100;

/**
 * Truncate output to the last N lines.
 *
 * @param output - The full output string
 * @param maxLines - Maximum number of lines to keep (default: MAX_OUTPUT_LINES)
 * @returns Truncated output with indicator if truncated
 */
function truncateOutput(output: string, maxLines: number = MAX_OUTPUT_LINES): string {
  const lines = output.split('\n');
  if (lines.length <= maxLines) {
    return output;
  }

  const truncatedLines = lines.slice(-maxLines);
  const droppedCount = lines.length - maxLines;
  return `[... ${droppedCount} lines truncated ...]\n${truncatedLines.join('\n')}`;
}

/**
 * Check if a service is running and healthy after restart.
 *
 * @param serviceName - Name of the service to check
 * @param projectName - Docker Compose project name
 * @param composeFile - Path to docker-compose.yaml
 * @returns Object with running status and container state
 */
function checkServiceHealth(
  serviceName: string,
  projectName: string,
  composeFile: string
): { running: boolean; status: string; error?: string } {
  try {
    // Get container status using docker compose ps with project name and compose file
    const output = execSync(
      `docker compose -p "${projectName}" -f "${composeFile}" ps --format json "${serviceName}"`,
      {
        encoding: 'utf-8',
        timeout: 10000,
      }
    );

    // Parse the JSON output (docker compose ps --format json returns one JSON object per line)
    const lines = output.trim().split('\n').filter(Boolean);
    if (lines.length === 0) {
      return { running: false, status: 'not found' };
    }

    // Parse the first (and should be only) container
    const container = JSON.parse(lines[0]);
    const state = container.State?.toLowerCase() || 'unknown';
    const isRunning = state === 'running';

    return {
      running: isRunning,
      status: state,
    };
  } catch (err) {
    const error = err as Error;
    return {
      running: false,
      status: 'error',
      error: error.message,
    };
  }
}

/**
 * Create a Docker Compose restart tool.
 *
 * This tool is considered dangerous because it restarts services which
 * can cause downtime and apply code changes. It uses step.waitForEvent()
 * to wait for human approval before executing, and step.run() for durable execution.
 *
 * The tool:
 * 1. Validates service name against allowlist (defense-in-depth)
 * 2. Generates a unique toolCallId for tracking (durably via step.run)
 * 3. Publishes hitl.requested event for dashboard
 * 4. Waits for human approval via step.waitForEvent()
 * 5. If approved, runs docker compose up --build --force-recreate -d
 * 6. Checks container health after restart
 * 7. Truncates output to last 100 lines
 *
 * @param context - Factory context with publish function
 * @returns Configured docker compose restart tool
 */
export function createDockerComposeRestartTool({ publish }: FactoryContext) {
  return createTool({
    name: 'docker_compose_restart',
    description:
      'Restart a Docker Compose service with rebuild. This is a dangerous operation that requires human approval. Use this after making code changes to apply them. Only specific services are allowed.',
    parameters: z.object({
      service: z
        .enum(ALLOWED_SERVICES)
        .describe('The service to restart (store-api, warehouse-alpha, warehouse-beta, bookstore-ui)'),
      reason: z
        .string()
        .describe('Clear explanation of why this service needs to be restarted'),
    }),
    handler: async ({ service, reason }, { step, network }) => {
      // Ensure step is available (it should always be in agent-kit context)
      if (!step) {
        return {
          success: false,
          error: 'Step context not available - tool must be run within Inngest function',
          service,
          toolCallId: 'unavailable',
        };
      }

      // Validate service against allowlist BEFORE waiting for approval
      // This provides defense-in-depth by rejecting unauthorized services
      // Even though Zod enum validates, we double-check for injection attempts
      const validation = validateServiceRestart(service);
      if (!validation.valid) {
        return {
          success: false,
          error: 'Service validation failed',
          reason: validation.reason,
          service,
          toolCallId: 'validation-failed',
        };
      }

      // Get compose file path and project name from environment
      const composeFile = getComposeFilePath();
      const projectName = getComposeProjectName();

      // Generate a unique toolCallId for this tool invocation DURABLY
      // This MUST be inside step.run() to ensure the same ID is used if the function
      // restarts between generating the ID and completing waitForEvent.
      // Use unique step ID based on input hash to avoid collisions when tool is called multiple times
      const inputHash = crypto
        .createHash('md5')
        .update(JSON.stringify({ service, reason }))
        .digest('hex')
        .slice(0, 8);
      const toolCallId = await step.run(`generate-docker-tool-id-${inputHash}`, () =>
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
                  toolName: 'docker_compose_restart',
                  toolInput: { service, reason },
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
      const approval = await step
        .waitForEvent(`wait-for-docker-approval-${toolCallId}`, {
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
      }

      // Check if approval was received and granted
      if (!approval || !approval.data.approved) {
        const feedback = approval?.data?.feedback;
        return {
          status: 'rejected' as const,
          success: false,
          error: 'Service restart rejected by human',
          feedback,
          service,
          reason,
          toolCallId,
        };
      }

      // Execute the restart operation with durability via step.run()
      const executionResult = await step.run(`docker-restart-${toolCallId}`, async () => {
        try {
          // Build and restart the service
          // -p projectName: Target the correct compose project (required from inside container)
          // -f composeFile: Explicit path to compose file (required since cwd is /app, not /workspace)
          // --build: Rebuild the image with code changes
          // --force-recreate: Ensure fresh container even if image unchanged
          // --no-deps: Don't rebuild/restart dependent services
          // -d: Run detached
          const command = `docker compose -p "${projectName}" -f "${composeFile}" up -d --build --force-recreate --no-deps "${service}"`;

          const rawOutput = execSync(command, {
            encoding: 'utf-8',
            timeout: 300000, // 5 minute timeout for build
            maxBuffer: 50 * 1024 * 1024, // 50MB buffer for build output
          });

          // Truncate output to prevent overwhelming the LLM
          const output = truncateOutput(rawOutput);

          // Check if service is actually running after restart
          const health = checkServiceHealth(service, projectName, composeFile);

          if (!health.running) {
            return {
              success: false,
              error: 'Service failed to start after restart',
              service,
              containerStatus: health.status,
              healthError: health.error,
              output,
              toolCallId,
            };
          }

          return {
            success: true,
            service,
            containerStatus: health.status,
            message: `Service ${service} restarted and running`,
            output,
            toolCallId,
          };
        } catch (err) {
          const error = err as Error & {
            status?: number;
            stderr?: string;
            stdout?: string;
          };

          // Truncate error output as well
          const stderr = error.stderr ? truncateOutput(error.stderr) : undefined;
          const stdout = error.stdout ? truncateOutput(error.stdout) : undefined;

          return {
            success: false,
            error: 'Docker compose restart failed',
            message: error.message,
            exitCode: error.status,
            stderr,
            stdout,
            service,
            toolCallId,
          };
        }
      });

      return executionResult;
    },
  });
}

/**
 * Metadata for docker tools, used by the agent layer
 * to determine which tools require HITL approval.
 */
export const dockerToolMetadata = {
  docker_compose_restart: {
    requiresApproval: true,
    riskLevel: 'high' as const,
    description: 'Restarts Docker Compose services with rebuild',
  },
};

/**
 * Create all docker tools with publish function injected.
 *
 * @param context - Factory context with publish function
 * @returns Array of docker tools
 */
export function createDockerTools(context: FactoryContext) {
  return [createDockerComposeRestartTool(context)];
}
