/**
 * State mutation tools for agent communication.
 *
 * These tools allow agents to signal state transitions within a network:
 * - report_findings: Log analyzer stores findings and hands off to coding agent
 * - complete_task: Any agent signals task completion
 *
 * State mutations must happen through tool handlers because agents cannot
 * directly mutate network.state.kv. These tools provide the mechanism for
 * agents to communicate state changes during network execution.
 */

import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';

/**
 * Schema for log analysis findings.
 */
const findingsSchema = z.object({
  service: z.string().describe('Service name where the issue was found'),
  errorType: z.string().describe('Type of error (e.g., "TypeError", "ConnectionError")'),
  errorMessage: z.string().describe('The error message'),
  file: z.string().optional().describe('Source file if identified'),
  line: z.number().optional().describe('Line number if identified'),
  stackTrace: z.string().optional().describe('Stack trace if available'),
  timestamp: z.string().optional().describe('When the error occurred'),
  suggestedAction: z.string().describe('Recommended next step'),
});

/**
 * Report findings from log analysis and optionally hand off to coding agent.
 *
 * Use this tool to store analysis findings in network state where other
 * agents can access them. When code investigation is needed, set
 * handoffToCoding to true to route to the coding agent.
 */
export const reportFindingsTool = createTool({
  name: 'report_findings',
  description:
    'Report log analysis findings and store them for other agents. Optionally hand off to the coding agent for code investigation.',
  parameters: z.object({
    findings: findingsSchema.describe('The findings from log analysis'),
    handoffToCoding: z
      .boolean()
      .default(false)
      .describe('Whether to hand off to coding agent for code investigation'),
  }),
  handler: async ({ findings, handoffToCoding }, { network }) => {
    if (!network) {
      return {
        error: 'Network context not available',
        success: false,
        message: 'This tool must be called within a network context',
      };
    }

    // Store findings in network state for other agents to access
    network.state.kv.set('log_findings', findings);

    // Optionally route to coding agent
    if (handoffToCoding) {
      network.state.kv.set('route_to', 'coding');
    }

    return {
      success: true,
      stored: 'log_findings',
      handoffTo: handoffToCoding ? 'coding' : null,
      findings,
    };
  },
});

/**
 * Signal that the current task is complete.
 *
 * Call this tool when you have finished your work to signal the network
 * to stop iteration. Include a summary of what was accomplished.
 */
export const completeTaskTool = createTool({
  name: 'complete_task',
  description:
    'Signal that your current task is complete. Call this when you have finished your work to stop the network iteration.',
  parameters: z.object({
    summary: z.string().describe('Summary of what was accomplished'),
    success: z.boolean().describe('Whether the task was completed successfully'),
    details: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Additional details about the completion'),
  }),
  handler: async ({ summary, success, details }, { network }) => {
    if (!network) {
      return {
        error: 'Network context not available',
        success: false,
        message: 'This tool must be called within a network context',
      };
    }

    // Signal completion to the network
    network.state.kv.set('complete', true);
    network.state.kv.set('task_summary', { summary, success, details });

    return {
      complete: true,
      summary,
      success,
    };
  },
});

/**
 * All state mutation tools as an array for convenient registration.
 */
export const stateTools = [reportFindingsTool, completeTaskTool];
