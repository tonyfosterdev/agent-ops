/**
 * Coding Agent Factory for AgentKit.
 *
 * Specializes in code analysis, debugging, and repairs. This agent can:
 * - Read and search code files to understand the codebase
 * - Execute shell commands for testing, building, and debugging (requires HITL)
 * - Write code fixes and modifications (requires HITL)
 *
 * ## Factory Pattern
 *
 * The agent is created via factory function to inject the publish function
 * into dangerous tools. This enables HITL events to be sent to the dashboard.
 *
 * ```typescript
 * const codingAgent = createCodingAgent({ publish });
 * ```
 *
 * The agent receives context from the log-analyzer agent via network.state.kv
 * when log analysis has identified issues that need code investigation.
 *
 * ## State Communication
 *
 * - Reads: log_findings (from log-analyzer agent)
 * - Writes: complete = true via complete_task tool when done
 *
 * ## Conversational Flow
 *
 * - ANSWER what you found in the code first
 * - SUGGEST fixes, don't auto-implement
 * - Wait for user confirmation before writing code
 * - Context from log_findings should inform investigation
 */
import { createAgent } from '@inngest/agent-kit';
import type { FactoryContext } from '../tools/types';
import {
  readFileTool,
  searchCodeTool,
  createShellExecuteTool,
  createWriteFileTool,
  createDockerComposeRestartTool,
  completeTaskTool,
} from '../tools/index';
import { codingSystemPrompt } from '../prompts/index';
import { STATE_KEYS } from '../constants/index';

/**
 * Create a coding agent with publish function injected.
 *
 * @param context - Factory context with publish function for HITL events
 * @returns Configured coding agent
 */
export function createCodingAgent({ publish }: FactoryContext) {
  return createAgent({
    name: 'coding',
    description:
      'Code analysis, debugging, and repairs. Use this agent for investigating code issues, fixing bugs, running tests, and making code modifications.',
    system: ({ network }) => {
      const logFindings = network?.state.kv.get(STATE_KEYS.LOG_FINDINGS);
      return codingSystemPrompt({ logFindings });
    },
    tools: [
      // Safe tools (no HITL needed)
      readFileTool,
      searchCodeTool,
      completeTaskTool,
      // Dangerous tools (need publish for HITL)
      createShellExecuteTool({ publish }),
      createWriteFileTool({ publish }),
      createDockerComposeRestartTool({ publish }),
    ],
  });
}
