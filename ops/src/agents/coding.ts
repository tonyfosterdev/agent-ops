/**
 * Coding Agent for AgentKit.
 *
 * Specializes in code analysis, debugging, and repairs. This agent can:
 * - Read and search code files to understand the codebase
 * - Execute shell commands for testing, building, and debugging (requires HITL)
 * - Write code fixes and modifications (requires HITL)
 *
 * The agent receives context from the log-analyzer agent via network.state.kv
 * when log analysis has identified issues that need code investigation.
 *
 * State Communication:
 * - Reads: log_findings (from log-analyzer agent)
 * - Writes: complete = true via complete_task tool when done
 */
import { createAgent } from '@inngest/agent-kit';
import {
  readFileTool,
  searchCodeTool,
  shellExecuteTool,
  writeFileTool,
  completeTaskTool,
} from '../tools/index.js';

export const codingAgent = createAgent({
  name: 'coding',
  description: 'Code analysis, debugging, and repairs. Use this agent for investigating code issues, fixing bugs, running tests, and making code modifications.',
  system: ({ network }) => {
    // Retrieve findings from log-analyzer if available
    const logFindings = network?.state.kv.get('log_findings');

    // Safely serialize findings with fallback
    let findingsContext = '';
    if (logFindings) {
      try {
        findingsContext = `
Context from log analysis:
${JSON.stringify(logFindings, null, 2)}

Use this context to guide your investigation. The log-analyzer has already identified potential issues that may need code fixes.`;
      } catch {
        findingsContext = `
Context from log analysis:
[Error: Could not serialize log findings]

Log findings are available but could not be displayed. Proceed with code investigation based on the task description.`;
      }
    }

    return `You are a coding agent specializing in debugging and code repairs.

Your capabilities:
- Read files to understand code structure and identify issues
- Search code for patterns, function definitions, and error sources
- Execute shell commands (npm test, build, lint, etc.) - requires human approval
- Write code fixes and modifications - requires human approval

Guidelines:
1. Always read relevant files before making changes
2. Search for related code to understand the full context
3. Explain your reasoning before proposing changes
4. When executing commands, provide clear reasons for why they're needed
5. Test your changes when possible (run tests, type-check, etc.)
${findingsContext}

When you have completed your task:
- Call the complete_task tool with a summary of what you found and what changes were made
- Set success to true if the task was completed successfully, false otherwise`;
  },
  tools: [readFileTool, searchCodeTool, shellExecuteTool, writeFileTool, completeTaskTool],
});
