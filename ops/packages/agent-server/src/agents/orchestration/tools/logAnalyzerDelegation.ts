/**
 * Delegation tool for Log Analyzer Agent
 */

import { z } from 'zod';
import { tool } from 'ai';
import { loadConfig } from 'ops-shared/config';
import { createLogAnalyzerAgent } from '../../log-analyzer';
import { NoOpOutputSink } from '../../../sinks/NoOpOutputSink.js';
import type { AgentResult } from 'ops-shared/types';

/**
 * Schema for log analyzer delegation tool
 */
export const runLogAnalyzerAgentSchema = z.object({
  task: z.string().describe('Task to send to log analyzer (Loki queries, error analysis, investigating failures)'),
});

// Empty context for delegated runs (no session history)
const emptyContext = { summary: null, recentMessages: [] };

/**
 * Create the log analyzer agent delegation tool
 */
export function createRunLogAnalyzerAgentTool() {
  return tool({
    description:
      'Delegate to the log analyzer agent. Use this when the task involves querying logs, analyzing errors, investigating distributed system issues, or tracing requests across services.',
    parameters: runLogAnalyzerAgentSchema,
    execute: async ({ task }) => {
      try {
        // Load log analyzer config
        const config = loadConfig('log-analyzer');

        // Create and initialize log analyzer agent
        const agent = await createLogAnalyzerAgent(config);

        // Create no-op sink (output captured in return value)
        const sink = new NoOpOutputSink();

        // Run task
        const result: AgentResult = await agent.run(task, emptyContext, sink);

        // Shutdown
        await agent.shutdown();

        // Return result
        return {
          success: result.success,
          message: result.message,
          steps: result.steps,
          agentType: 'log-analyzer',
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Log analyzer agent error: ${error.message}`,
          steps: 0,
          agentType: 'log-analyzer',
          error: error.message,
        };
      }
    },
  });
}
