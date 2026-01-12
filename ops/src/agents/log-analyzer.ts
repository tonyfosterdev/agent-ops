/**
 * Log Analyzer Agent Factory for AgentKit.
 *
 * Specializes in log parsing, pattern detection, and diagnostics using
 * Grafana Loki. This agent can:
 * - Query logs using LogQL to find errors and anomalies
 * - Discover available log labels and their values
 * - Identify patterns and correlate events across services
 *
 * ## Factory Pattern
 *
 * The agent is created via factory function for consistency with other agents,
 * even though it doesn't currently use dangerous tools.
 *
 * ```typescript
 * const logAnalyzer = createLogAnalyzer({ publish });
 * ```
 *
 * The agent stores its findings in network.state.kv for use by other agents
 * (such as the coding agent) when code investigation is needed.
 *
 * ## State Communication
 *
 * - Writes: log_findings via report_findings tool (findings for other agents to consume)
 * - Writes: complete = true via complete_task tool when done
 * - Reads: needs_clarification (set by router when intent is ambiguous)
 *
 * ## Conversational Flow
 *
 * - ANSWER the user's question first with findings from logs
 * - SUGGEST next steps (don't auto-execute)
 * - ASK before handing off to coding agent
 * - Never auto-handoff via report_findings(handoffToCoding: true)
 */
import { createAgent } from '@inngest/agent-kit';
import type { FactoryContext } from '../tools/types';
import {
  lokiQueryTool,
  lokiLabelsTool,
  lokiLabelValuesTool,
  reportFindingsTool,
  completeTaskTool,
} from '../tools/index';
import { logAnalyzerSystemPrompt } from '../prompts/index';
import { STATE_KEYS } from '../constants/index';

/**
 * Create a log analyzer agent.
 *
 * Note: This agent uses only safe tools (no HITL required), but accepts
 * FactoryContext for consistency with other agent factories. The publish
 * function is currently unused but available for future extensions.
 *
 * @param _context - Factory context (currently unused, for future extensions)
 * @returns Configured log analyzer agent
 */
export function createLogAnalyzer(_context: FactoryContext) {
  return createAgent({
    name: 'log-analyzer',
    description:
      'Log parsing, pattern detection, and diagnostics. Use this agent for investigating application logs, identifying errors, and analyzing service health.',
    system: ({ network }) => {
      // Check if router flagged this as needing clarification
      const needsClarification = network?.state.kv.get(STATE_KEYS.NEEDS_CLARIFICATION);

      // Clear the flag so we don't keep asking
      if (needsClarification) {
        network?.state.kv.delete(STATE_KEYS.NEEDS_CLARIFICATION);
      }

      return logAnalyzerSystemPrompt({ needsClarification: !!needsClarification });
    },
    // All tools are safe (no HITL required)
    tools: [lokiQueryTool, lokiLabelsTool, lokiLabelValuesTool, reportFindingsTool, completeTaskTool],
  });
}
