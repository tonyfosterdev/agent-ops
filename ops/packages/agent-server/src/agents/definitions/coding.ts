/**
 * Coding Agent Definition
 *
 * Debugging and code modification agent with file and log analysis tools.
 */

import type { AgentDefinition, ToolContext } from '../types';
import { getSystemPrompt } from '../coding/prompts';
import {
  createShellTool,
  createReadFileTool,
  createWriteFileTool,
  createFindFilesTool,
  createSearchCodeTool,
  createLokiQueryTool,
  createLokiLabelsTool,
  createLokiServiceErrorsTool,
  createRestartServiceTool,
} from '../coding/tools';

export const codingDefinition: AgentDefinition = {
  agentType: 'coding',

  getSystemPrompt() {
    return getSystemPrompt();
  },

  getTools(ctx: ToolContext) {
    return {
      shell_command_execute: createShellTool(ctx.workDir),
      read_file: createReadFileTool(ctx.workDir),
      write_file: createWriteFileTool(ctx.workDir),
      find_files: createFindFilesTool(ctx.workDir),
      search_code: createSearchCodeTool(ctx.workDir),
      loki_query: createLokiQueryTool(ctx.lokiUrl),
      loki_labels: createLokiLabelsTool(ctx.lokiUrl),
      loki_service_errors: createLokiServiceErrorsTool(ctx.lokiUrl),
      restart_service: createRestartServiceTool(ctx.workDir),
    };
  },
};
