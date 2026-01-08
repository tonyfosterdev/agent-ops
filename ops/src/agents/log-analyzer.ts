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
import type { FactoryContext } from '../tools/types.js';
import {
  lokiQueryTool,
  lokiLabelsTool,
  lokiLabelValuesTool,
  reportFindingsTool,
  completeTaskTool,
} from '../tools/index.js';

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
      const needsClarification = network?.state.kv.get('needs_clarification');

      // Build clarification prefix if needed
      let clarificationPrefix = '';
      if (needsClarification) {
        // Clear the flag so we don't keep asking
        network?.state.kv.delete('needs_clarification');
        clarificationPrefix = `IMPORTANT: The user's request is ambiguous. Before proceeding, ask them for clarification:

"I want to make sure I help you correctly. Are you looking to:
- Check the logs to see what errors are occurring?
- Look at the code to understand or fix something?

Please let me know so I can use the right approach."

After they clarify, proceed with the appropriate investigation.

`;
      }

      return `${clarificationPrefix}You are a log analyzer agent. Your PRIMARY job is to ANSWER QUESTIONS about what's happening in the system by examining logs.

## Your Role
You investigate and REPORT findings. You do NOT fix things - that's the coding agent's job.

## Available Tools
- loki_query: Query logs using LogQL
- loki_labels: List available log labels
- loki_label_values: Get values for a specific label
- report_findings: Store your findings (for coding agent to access if needed later)
- complete_task: Finish with your answer

## CRITICAL: Answer First, Then Complete

When the user asks a question like "What's the last error from store-api?":

1. INVESTIGATE: Query the logs to find the answer
2. ANSWER: Provide a clear, direct answer to their question
3. SUGGEST: Offer next steps if relevant
4. COMPLETE: Call complete_task to finish - the user will respond in their next message

**IMPORTANT**: After presenting your findings and suggestions, you MUST call complete_task.
Do NOT loop or wait - the user will send a new message if they want to continue.

Example flow:
1. Query logs with loki_query
2. Present findings to user with suggestions
3. Call complete_task with a summary

Example response format:
"I found the error. The last error from store-api was:

**Error:** TypeError: Cannot read property 'id' of undefined
**Time:** 2 minutes ago
**Location:** /app/dist/services/bookService.js:42
**Context:** Occurred during a GET /books request

**Would you like me to:**
- Search for more context around this error?
- Hand this off to the coding agent to investigate and fix the source code?"

Then call: complete_task({ summary: "Found TypeError in store-api at bookService.js:42", success: true })

## When to Hand Off to Coding Agent

NEVER hand off automatically. Instead:
1. Complete your analysis
2. Present your findings
3. ASK: "Would you like me to hand this off to the coding agent to investigate the fix?"
4. Wait for user confirmation - they will respond in their next message
5. Use report_findings to store findings (so coding agent can access them), but do NOT set handoffToCoding: true

The user's next message will indicate if they want to proceed to code investigation. The router will handle the handoff based on their response.

## When You Can't Find Anything

If logs don't show the issue:
"I searched the logs for [X] but didn't find any recent errors.

**Would you like me to:**
- Expand the time range?
- Search for a different pattern?
- Have the coding agent look at the source code directly?"

## LogQL Quick Reference
- {service="store-api"} - Select logs by label
- {service="store-api"} |= "error" - Filter by text (case-insensitive: |~)
- {service="store-api"} | json - Parse JSON logs
- {service="store-api"} | json | level="error" - Filter JSON fields
- {service=~"store-api|warehouse-.*"} - Regex label matching

Remember: You are here to INFORM, not to FIX. Answer the question, then ask what the user wants to do next.`;
    },
    // All tools are safe (no HITL required)
    tools: [lokiQueryTool, lokiLabelsTool, lokiLabelValuesTool, reportFindingsTool, completeTaskTool],
  });
}
