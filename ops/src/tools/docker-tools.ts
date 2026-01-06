/**
 * Docker Compose tools for AgentKit.
 *
 * These are dangerous tools that require human approval (HITL)
 * before execution. The tool uses Inngest's step.waitForEvent()
 * to pause execution until approval is received.
 *
 * HITL Event Correlation Pattern:
 *
 * 1. Tool generates a unique toolCallId in step.run() - this is durable
 * 2. Tool waits for 'agentops/tool.approval' event with if: 'async.data.toolCallId == "${toolCallId}"'
 * 3. The useAgent hook on the frontend shows pending tool calls in the message stream
 * 4. User clicks Approve/Deny, which calls approveToolCall(toolCallId) or denyToolCall(toolCallId, reason)
 * 5. The hook sends the approval event to Inngest with the matching toolCallId
 * 6. waitForEvent resolves and execution continues
 *
 * Defense-in-Depth:
 *
 * Service names are validated against an allowlist BEFORE being sent for HITL approval.
 * This prevents unauthorized service restarts from even reaching the approval queue.
 * The allowlist is defined in security.ts and includes only safe services.
 *
 * Post-Restart Health Check:
 *
 * After restarting a service, the tool verifies the container is actually running
 * by checking `docker compose ps`. This ensures the restart was successful and
 * the service is healthy, not just that the restart command exited.
 *
 * Output Truncation:
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
import type { AgentStreamEvent } from '../inngest/realtime.js';

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
 * Restart a Docker Compose service with rebuild.
 *
 * This tool is considered dangerous because it restarts services which
 * can cause downtime and apply code changes. It uses step.waitForEvent()
 * to wait for human approval before executing, and step.run() for durable execution.
 *
 * The tool:
 * 1. Validates service name against allowlist (defense-in-depth)
 * 2. Generates a unique toolCallId for tracking
 * 3. Waits for human approval via step.waitForEvent()
 * 4. If approved, runs docker compose up --build --force-recreate -d
 * 5. Checks container health after restart
 * 6. Truncates output to last 100 lines
 */
export const dockerComposeRestartTool = createTool({
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

    // Get the publish function from network state (set by the Inngest function)
    const publishEvent = network?.state?.kv?.get('publish') as
      | ((event: AgentStreamEvent) => void)
      | undefined;

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
    // Without this, a restart would generate a new ID and break approval correlation.
    const toolCallId = await step.run('generate-docker-tool-id', () => crypto.randomUUID());

    // Publish tool.call event BEFORE waiting for approval
    // This allows the dashboard to show the approval UI immediately
    if (publishEvent) {
      publishEvent({
        type: 'tool.call',
        toolName: 'docker_compose_restart',
        toolCallId,
        args: { service, reason, projectName },
        requiresApproval: true,
        approvalRequestId: toolCallId,
        reason,
        agentName: network?.state?.kv?.get('agentName') as string | undefined,
      });
    }

    // Wait for human approval (4 hour timeout)
    // The approval event must include the toolCallId in its data
    // Using dynamic step ID to avoid collisions if tool is called multiple times
    // NOTE: We use 'if' instead of 'match' because 'match' compares against the
    // triggering event (agent/chat) which doesn't have toolCallId. The 'if'
    // expression filters incoming events by their data.toolCallId field.
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

    // Check if approval was received and granted
    if (!approval || !approval.data.approved) {
      const feedback = approval?.data?.feedback;
      const result = {
        status: 'rejected' as const,
        success: false,
        error: 'Service restart rejected by human',
        feedback,
        service,
        reason,
        toolCallId,
      };

      // Publish tool.result event for rejection
      if (publishEvent) {
        publishEvent({
          type: 'tool.result',
          toolCallId,
          result,
          isError: true,
          rejectionFeedback: feedback,
        });
      }

      return result;
    }

    // Execute the restart operation with durability via step.run()
    // Using dynamic step ID to avoid collisions
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

    // Publish tool.result event after execution
    if (publishEvent) {
      publishEvent({
        type: 'tool.result',
        toolCallId,
        result: executionResult,
        isError: !executionResult.success,
      });
    }

    return executionResult;
  },
});

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
 * All docker tools as an array for convenient registration.
 */
export const dockerTools = [dockerComposeRestartTool];
