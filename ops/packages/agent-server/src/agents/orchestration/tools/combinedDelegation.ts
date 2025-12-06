/**
 * Combined delegation tool for running both agents
 */

import { z } from 'zod';
import { tool } from 'ai';
import { loadConfig } from 'ops-shared/config';
import { createCodingAgent } from '../../coding';
import { createLogAnalyzerAgent } from '../../log-analyzer';
import type { AgentResult } from 'ops-shared/types';

/**
 * Schema for combined delegation tool
 */
export const runBothAgentsSchema = z.object({
  codingTask: z.string().describe('Specific task for coding agent'),
  logAnalysisTask: z.string().describe('Specific task for log analyzer'),
  executionMode: z
    .enum(['sequential', 'parallel'])
    .describe('Run agents in sequence (when dependent) or parallel (when independent)'),
});

/**
 * Create the combined delegation tool
 */
export function createRunBothAgentsTool() {
  return tool({
    description:
      'Delegate to BOTH coding and log analyzer agents. Use this when the task requires both code work AND log analysis. Choose sequential when one task depends on the other, parallel when tasks are independent.',
    parameters: runBothAgentsSchema,
    execute: async ({ codingTask, logAnalysisTask, executionMode }) => {
      try {
        if (executionMode === 'sequential') {
          // Run coding agent first, then log analyzer
          const codingConfig = loadConfig('coding');
          const codingAgent = await createCodingAgent(codingConfig);
          const codingResult: AgentResult = await codingAgent.run(codingTask);
          await codingAgent.shutdown();

          const logConfig = loadConfig('log-analyzer');
          const logAgent = await createLogAnalyzerAgent(logConfig);
          const logResult: AgentResult = await logAgent.run(logAnalysisTask);
          await logAgent.shutdown();

          // Combine results
          const success = codingResult.success && logResult.success;
          const message = formatCombinedMessage(codingResult, logResult);
          const steps = codingResult.steps + logResult.steps;

          return {
            success,
            message,
            steps,
            executionMode: 'sequential',
            codingSuccess: codingResult.success,
            logAnalyzerSuccess: logResult.success,
          };
        } else {
          // Run both agents in parallel
          const [codingResult, logResult] = await Promise.all([
            (async () => {
              const config = loadConfig('coding');
              const agent = await createCodingAgent(config);
              const result = await agent.run(codingTask);
              await agent.shutdown();
              return result;
            })(),
            (async () => {
              const config = loadConfig('log-analyzer');
              const agent = await createLogAnalyzerAgent(config);
              const result = await agent.run(logAnalysisTask);
              await agent.shutdown();
              return result;
            })(),
          ]);

          // Combine results
          const success = codingResult.success && logResult.success;
          const message = formatCombinedMessage(codingResult, logResult);
          const steps = codingResult.steps + logResult.steps;

          return {
            success,
            message,
            steps,
            executionMode: 'parallel',
            codingSuccess: codingResult.success,
            logAnalyzerSuccess: logResult.success,
          };
        }
      } catch (error: any) {
        return {
          success: false,
          message: `Combined execution error: ${error.message}`,
          steps: 0,
          error: error.message,
        };
      }
    },
  });
}

/**
 * Format combined results from both agents
 */
function formatCombinedMessage(codingResult: AgentResult, logResult: AgentResult): string {
  const codingIcon = codingResult.success ? '✅' : '❌';
  const logIcon = logResult.success ? '✅' : '❌';

  return `CODING AGENT RESULT:
${codingIcon} ${codingResult.message}

LOG ANALYZER AGENT RESULT:
${logIcon} ${logResult.message}`;
}
