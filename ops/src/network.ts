/**
 * Agent Network with Hybrid Router for AgentOps.
 *
 * Creates the AgentKit network that orchestrates multiple agents for
 * operations tasks. The network uses a hybrid routing strategy:
 *
 * 1. Deterministic code-based rules (fast, predictable)
 * 2. Agent-requested handoffs via state (explicit delegation)
 * 3. AgentKit's built-in LLM routing agent (fallback for ambiguous cases)
 *
 * ## Agents
 *
 * - codingAgent: Code analysis, debugging, and repairs
 * - logAnalyzer: Log parsing, pattern detection, and diagnostics
 *
 * ## State Communication
 *
 * Agents communicate via network.state.kv:
 * - `log_findings`: Findings from log analysis (set by logAnalyzer)
 * - `route_to`: Explicit handoff request (consumed and cleared by router)
 * - `complete`: Set to true when work is done (network stops)
 * - `runId`: Inngest run ID for HITL event correlation
 * - `threadId`: Thread ID for history persistence
 *
 * ## History Integration
 *
 * The network can be run with pre-loaded history from the database:
 *
 * ```typescript
 * const history = await historyAdapter.get(threadId);
 * const result = await agentNetwork.run(message, { step, history });
 * await historyAdapter.appendResults(threadId, result.messages);
 * ```
 */

import { createNetwork, type Agent } from '@inngest/agent-kit';
import { anthropic } from '@inngest/agent-kit';
import { codingAgent, logAnalyzer } from './agents/index.js';

/**
 * The main agent network for operations tasks.
 *
 * Orchestrates the coding and log-analyzer agents using a hybrid
 * routing strategy that prioritizes deterministic rules over LLM inference.
 */
export const agentNetwork = createNetwork({
  name: 'ops-network',
  agents: [codingAgent, logAnalyzer],
  defaultModel: anthropic({
    model: 'claude-sonnet-4-20250514',
    defaultParameters: {
      max_tokens: 4096,
    },
  }),

  // Limit iterations to prevent runaway execution
  maxIter: 15,

  /**
   * Sticky router: once an agent is selected, it keeps running until handoff.
   *
   * Routing priority:
   * 1. Check if work is complete (stop the network)
   * 2. Check for explicit handoff request via state
   * 3. If an agent is already active, keep using it (sticky behavior)
   * 4. For initial routing, use keyword-based rules on the INPUT only
   *
   * This prevents the router from switching agents based on agent output,
   * which caused issues where agents would mention keywords that triggered
   * routing to an agent without the required tools.
   */
  router: async ({ network, input, lastResult }) => {
    const state = network.state.kv;

    // 1. Check if work is complete - return undefined to stop the network
    if (state.get('complete')) {
      state.delete('currentAgent'); // Clean up
      return undefined;
    }

    // 2. Check if an agent explicitly requested a handoff via state
    // This takes priority because it represents an agent's deliberate decision
    const nextAgent = state.get('route_to') as string | undefined;
    if (nextAgent) {
      // Clear the route_to flag to prevent routing loops
      state.delete('route_to');

      // Update the current agent
      state.set('currentAgent', nextAgent);

      if (nextAgent === 'coding') {
        return codingAgent;
      }
      if (nextAgent === 'log-analyzer') {
        return logAnalyzer;
      }
    }

    // 3. Sticky behavior: if an agent is already running, keep using it
    // This prevents switching based on agent output containing keywords
    const currentAgent = state.get('currentAgent') as string | undefined;
    if (currentAgent && lastResult) {
      // Agent has already produced output, keep using the same agent
      if (currentAgent === 'coding') {
        return codingAgent;
      }
      if (currentAgent === 'log-analyzer') {
        return logAnalyzer;
      }
    }

    // 4. Initial routing: use keyword-based rules on the ORIGINAL INPUT only
    // This only runs on the first iteration (when lastResult is undefined)
    const lowerInput = input.toLowerCase();

    // Check code keywords FIRST - coding agent can delegate to log-analyzer
    // This prevents log-analyzer from trying to use code tools it doesn't have
    if (containsCodeKeywords(lowerInput)) {
      state.set('currentAgent', 'coding');
      return codingAgent;
    }

    // Route log-related queries to log-analyzer
    if (containsLogKeywords(lowerInput)) {
      state.set('currentAgent', 'log-analyzer');
      return logAnalyzer;
    }

    // 5. Fallback: Default to coding agent for general tasks
    // Coding agent has more versatile tools and can hand off to log-analyzer
    state.set('currentAgent', 'coding');
    return codingAgent;
  },
});

/**
 * Extract text content from a message object.
 *
 * AgentKit messages can have various content formats:
 * - String (simple text)
 * - Array of parts (with text, tool calls, etc.)
 * - Object with content property
 */
function extractMessageContent(message: unknown): string {
  if (!message) return '';

  // Handle string content directly
  if (typeof message === 'string') return message;

  // Handle message object with content property
  if (typeof message === 'object' && message !== null) {
    const msg = message as Record<string, unknown>;

    // Direct content property (string)
    if (typeof msg.content === 'string') {
      return msg.content;
    }

    // Content as array of parts
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((part: unknown) => {
          if (typeof part === 'string') return part;
          if (typeof part === 'object' && part !== null) {
            const p = part as Record<string, unknown>;
            if (p.type === 'text' && typeof p.text === 'string') {
              return p.text;
            }
          }
          return '';
        })
        .join(' ');
    }
  }

  return '';
}

/**
 * Check if content contains log-related keywords.
 */
function containsLogKeywords(content: string): boolean {
  const logKeywords = [
    'log',
    'logs',
    'error',
    'errors',
    'trace',
    'traces',
    'loki',
    'logql',
    'warning',
    'warnings',
    'exception',
    'stack trace',
    'stacktrace',
  ];

  return logKeywords.some((keyword) => content.includes(keyword));
}

/**
 * Check if content contains code-related keywords.
 */
function containsCodeKeywords(content: string): boolean {
  const codeKeywords = [
    // Direct code references
    'code',
    'codebase',
    'source',
    'src',
    'file',
    'files',
    // Actions
    'fix',
    'debug',
    'search',
    'find',
    'look',
    'check',
    'read',
    'write',
    'modify',
    'change',
    'update',
    // Code structure
    'function',
    'class',
    'method',
    'variable',
    'module',
    'import',
    'export',
    // Tasks
    'implement',
    'refactor',
    'review',
    // Languages/tools
    'typescript',
    'javascript',
    'python',
    'node',
    'npm',
    // Dev tasks
    'test',
    'tests',
    'build',
    'compile',
    'lint',
    'type-check',
  ];

  return codeKeywords.some((keyword) => content.includes(keyword));
}

export type { Agent };
