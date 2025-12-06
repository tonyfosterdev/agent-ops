/**
 * Delegation tool for Coding Agent
 */

import { z } from 'zod';
import { tool } from 'ai';
import { loadConfig, getPathMappingConfig, translateDockerPaths } from 'ops-shared';
import { createCodingAgent } from '../../coding';
import type { AgentResult } from 'ops-shared/types';

/**
 * Schema for coding delegation tool
 */
export const runCodingAgentSchema = z.object({
  task: z.string().describe('Task to send to coding agent (debugging, file fixes, shell commands)'),
});

/**
 * Create the coding agent delegation tool
 */
export function createRunCodingAgentTool() {
  return tool({
    description:
      'Delegate to the coding agent. Use this when the task involves debugging code, fixing TypeScript files, running shell commands, or modifying files.',
    parameters: runCodingAgentSchema,
    execute: async ({ task }) => {
      try {
        // Load coding agent config
        const config = loadConfig('coding');

        // Translate Docker paths to local paths (e.g., /workspace → local workDir)
        const pathConfig = getPathMappingConfig();
        const translatedTask = translateDockerPaths(task, pathConfig);

        // Create and initialize coding agent
        const agent = await createCodingAgent(config);

        // Run task with translated paths
        const result: AgentResult = await agent.run(translatedTask);

        // Shutdown
        await agent.shutdown();

        // Return result
        return {
          success: result.success,
          message: result.message,
          steps: result.steps,
          agentType: 'coding',
        };
      } catch (error: any) {
        return {
          success: false,
          message: `Coding agent error: ${error.message}`,
          steps: 0,
          agentType: 'coding',
          error: error.message,
        };
      }
    },
  });
}
