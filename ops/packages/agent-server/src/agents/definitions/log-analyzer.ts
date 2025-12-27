/**
 * Log Analyzer Agent Definition
 *
 * Log analysis and investigation agent with Loki query and reporting tools.
 */

import type { AgentDefinition, ToolContext } from '../types';
import { getSystemPrompt } from '../log-analyzer/prompts';
import {
  createLokiQueryTool,
  createLogAnalysisTool,
  createReportGenerationTool,
} from '../log-analyzer/tools';

export const logAnalyzerDefinition: AgentDefinition = {
  agentType: 'log-analyzer',

  getSystemPrompt() {
    return getSystemPrompt();
  },

  getTools(ctx: ToolContext) {
    return {
      loki_query: createLokiQueryTool(ctx.lokiUrl),
      analyze_logs: createLogAnalysisTool(),
      generate_report: createReportGenerationTool(),
    };
  },
};
