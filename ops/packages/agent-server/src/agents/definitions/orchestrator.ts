/**
 * Orchestrator Agent Definition
 *
 * Task routing and delegation agent that coordinates specialized sub-agents.
 */

import type { AgentDefinition, ToolContext } from '../types';
import { getSystemPrompt } from '../orchestration/prompts';
import { createRunCodingAgentTool, createRunLogAnalyzerTool } from '../../tools/delegation';

export const orchestratorDefinition: AgentDefinition = {
  agentType: 'orchestrator',

  getSystemPrompt() {
    // Update prompt to emphasize SEQUENTIAL execution only
    return getSystemPrompt() + `

IMPORTANT: Execute sub-agent tasks SEQUENTIALLY. Call one sub-agent at a time and wait for results before proceeding.
The run_both_agents tool has been removed - instead, call agents one by one in the order needed.`;
  },

  getTools(ctx: ToolContext) {
    return {
      run_coding_agent: createRunCodingAgentTool(ctx),
      run_log_analyzer_agent: createRunLogAnalyzerTool(ctx),
      // NOTE: run_both_agents removed - orchestrator should call sequentially
    };
  },
};
