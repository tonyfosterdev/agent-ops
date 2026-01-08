/**
 * Agent Network Factory with LLM-Only Router for AgentOps.
 *
 * Creates the AgentKit network that orchestrates multiple agents for
 * operations tasks. The network uses LLM classification for all initial
 * routing decisions to ensure correctness.
 *
 * ## Factory Pattern
 *
 * The network is created via factory function to inject the publish function
 * into agents that use dangerous tools requiring HITL approval:
 *
 * ```typescript
 * const network = createAgentNetwork({ publish });
 * ```
 *
 * ## Routing Priority
 *
 * 1. Completion check - Stop if work is done
 * 2. User confirmed handoff - User said "yes" to a handoff suggestion
 * 3. Agent-requested handoff - Explicit delegation via state
 * 4. Sticky behavior - Keep current agent running
 * 5. LLM classification - Route based on intent analysis
 *
 * ## Design Decision
 *
 * We use LLM-only routing (no keyword matching) because:
 * - Keyword matching has false positives (e.g., "fix the" in "I got an error trying to fix the code")
 * - LLM understands context and nuance that keywords cannot
 * - Correctness is prioritized over latency
 * - Future optimization: add keyword caching for proven patterns if needed
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
 * - `userId`: User ID for thread ownership
 * - `handoff_suggested`: Agent suggested handoff, awaiting user confirmation
 * - `needs_clarification`: Router flagged ambiguous input, agent should ask
 *
 * ## History Integration
 *
 * The network uses AgentKit's HistoryConfig for automatic persistence:
 * - createThread: Creates/ensures thread exists (supports client-generated IDs)
 * - get: Loads conversation history from database
 * - appendUserMessage: Saves user message at start of run
 * - appendResults: Saves agent results after run completes
 *
 * History is managed entirely by the network - callers just need to provide
 * userId and optionally threadId in the state.
 */

import { createNetwork, AgentResult } from '@inngest/agent-kit';
import { anthropic } from '@inngest/agent-kit';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { createCodingAgent, createLogAnalyzer } from './agents/index.js';
import type { FactoryContext } from './tools/types.js';
import { config } from './config.js';
import { historyAdapter, type StoredMessage } from './db/index.js';

/**
 * Lazy-initialized Anthropic client for router LLM calls.
 * Uses the same API key as the main agent network.
 */
let routerClient: Anthropic | null = null;

function getRouterClient(): Anthropic {
  if (!routerClient) {
    routerClient = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }
  return routerClient;
}

/**
 * Configurable confidence threshold for LLM routing decisions.
 * Below this threshold, the router will ask for clarification.
 */
const ROUTING_CONFIDENCE_THRESHOLD = parseFloat(process.env.ROUTING_CONFIDENCE_THRESHOLD ?? '0.7');

/**
 * Convert stored messages to AgentResult[] format for AgentKit history.
 *
 * Groups consecutive assistant messages from the same agent into single AgentResult objects.
 * User messages are handled separately via appendUserMessage.
 */
function convertToAgentResults(messages: StoredMessage[]): AgentResult[] {
  const results: AgentResult[] = [];

  for (const msg of messages) {
    // Skip user messages - they're handled separately
    if (msg.role === 'user') continue;

    // Create an AgentResult for each assistant/tool message
    // In the future, we could group consecutive messages from the same agent
    if (msg.role === 'assistant' || msg.role === 'tool') {
      const output =
        typeof msg.content === 'string'
          ? [{ type: 'text' as const, role: 'assistant' as const, content: msg.content }]
          : Array.isArray(msg.content)
            ? msg.content
            : [{ type: 'text' as const, role: 'assistant' as const, content: JSON.stringify(msg.content) }];

      results.push(
        new AgentResult(
          msg.agentName || 'unknown',
          output,
          [], // toolCalls - could be populated from tool messages
          msg.createdAt,
          undefined, // prompt
          undefined, // history
          undefined, // raw
          msg.id // id
        )
      );
    }
  }

  return results;
}

/**
 * Schema for LLM routing decisions.
 */
const routingDecisionSchema = z.object({
  agent: z.enum(['log-analyzer', 'coding', 'unclear']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

type RoutingDecision = z.infer<typeof routingDecisionSchema>;

/**
 * Check if user is confirming a handoff suggestion.
 *
 * Detects affirmative responses like "yes", "ok", "sure", etc.
 * Uses strict matching to avoid false positives on phrases
 * that just happen to start with these words.
 */
function userConfirmsHandoff(input: string): boolean {
  const confirmations = [
    'yes',
    'yeah',
    'yep',
    'ok',
    'okay',
    'sure',
    'go ahead',
    'do it',
    'proceed',
    'yes please',
    'please do',
    'please proceed',
    'sounds good',
    "let's do it",
  ];
  const lower = input.toLowerCase().trim();

  // Check for exact match or match at start of sentence
  return confirmations.some(
    (c) => lower === c || lower.startsWith(c + ' ') || lower.startsWith(c + ',') || lower.startsWith(c + '.')
  );
}

/**
 * Classify user intent using LLM for ambiguous cases.
 *
 * Uses structured messages to prevent prompt injection and
 * validates response with Zod schema. Falls back to log-analyzer
 * on any errors for safety (read-only operations).
 *
 * Uses a small, fast model (claude-3.5-haiku) for quick routing decisions.
 */
async function classifyIntentWithLLM(input: string): Promise<RoutingDecision> {
  try {
    const client = getRouterClient();

    // Use structured messages to prevent prompt injection
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 150,
      system: `You are a routing classifier. Analyze the user's message and determine their intent.

Return ONLY valid JSON in this exact format:
{"agent": "log-analyzer" | "coding" | "unclear", "confidence": 0.0-1.0, "reason": "brief explanation"}

Categories:
- log-analyzer: Questions about errors, logs, what happened, checking status, investigating issues
- coding: Requests to fix code, modify files, implement features, write code
- unclear: Genuinely ambiguous, could be either, need more context

Examples:
- "What's causing the 500 errors?" -> {"agent": "log-analyzer", "confidence": 0.9, "reason": "investigating errors"}
- "Fix the authentication bug" -> {"agent": "coding", "confidence": 0.95, "reason": "explicit fix request"}
- "The API is broken" -> {"agent": "unclear", "confidence": 0.4, "reason": "could be log investigation or code fix"}`,
      messages: [
        {
          role: 'user',
          content: input,
        },
      ],
    });

    // Extract text content from response
    const textContent = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Parse JSON from response
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[router] Could not extract JSON from LLM response:', textContent);
      return { agent: 'log-analyzer', confidence: 0.5, reason: 'parse_error_fallback' };
    }

    const parsed = routingDecisionSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) {
      console.warn('[router] Invalid LLM response schema:', parsed.error.message);
      return { agent: 'log-analyzer', confidence: 0.5, reason: 'schema_error_fallback' };
    }

    return parsed.data;
  } catch (error) {
    console.error('[router] LLM classification failed:', error);
    return { agent: 'log-analyzer', confidence: 0.5, reason: 'api_error_fallback' };
  }
}

/**
 * Create the agent network with publish function injected.
 *
 * The publish function is passed to agents that use dangerous tools,
 * enabling them to emit hitl.requested events for the dashboard.
 *
 * @param context - Factory context with publish function
 * @returns Configured agent network
 */
export function createAgentNetwork({ publish }: FactoryContext) {
  // Create agents with publish function injected
  const codingAgent = createCodingAgent({ publish });
  const logAnalyzer = createLogAnalyzer({ publish });

  return createNetwork({
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
     * History configuration for thread and message persistence.
     *
     * Uses client-authoritative threadIds - if the client provides a threadId,
     * we ensure the thread exists. Otherwise, we create a new one.
     */
    history: {
      /**
       * Create or ensure thread exists when needed.
       * Supports both server-generated and client-generated threadIds.
       */
      createThread: async ({ state }) => {
        const userId = state.kv.get('userId') as string;
        const clientThreadId = state.kv.get('threadId') as string | undefined;

        if (clientThreadId) {
          // Client-authoritative: ensure thread exists with client-provided ID
          await historyAdapter.ensureThread(clientThreadId, userId);
          return { threadId: clientThreadId };
        }

        // Server-authoritative: create new thread
        const threadId = await historyAdapter.createThread(userId);
        return { threadId };
      },

      /**
       * Load conversation history from database.
       * Verifies thread ownership before returning messages.
       */
      get: async ({ threadId, state }) => {
        if (!threadId) return [];

        // Verify thread ownership
        const userId = state.kv.get('userId') as string;
        const thread = await historyAdapter.getThread(threadId);
        if (!thread) {
          console.warn(`[history] Thread ${threadId} not found`);
          return [];
        }
        if (thread.userId !== userId) {
          console.error(`[history] Unauthorized: User ${userId} cannot access thread ${threadId}`);
          throw new Error(`Unauthorized access to thread ${threadId}`);
        }

        const messages = await historyAdapter.get(threadId);
        return convertToAgentResults(messages);
      },

      /**
       * Save user message immediately at start of run.
       */
      appendUserMessage: async ({ threadId, userMessage }) => {
        if (!threadId) return;
        await historyAdapter.appendMessage(threadId, 'user', userMessage.content);
      },

      /**
       * Save agent results after run completes.
       */
      appendResults: async ({ threadId, newResults }) => {
        if (!threadId) return;
        const messages = newResults.flatMap((result) =>
          result.output.map((output) => ({
            role: 'assistant' as const,
            content: output,
            agentName: result.agentName,
          }))
        );
        await historyAdapter.appendResults(threadId, messages);
      },
    },

    /**
     * LLM-only router for intent classification.
     *
     * Routing priority:
     * 1. Completion check - Stop if work is done
     * 2. User confirmed handoff - User said "yes" to a handoff suggestion
     * 3. Agent-requested handoff - Explicit delegation via state
     * 4. Sticky behavior - Keep current agent running
     * 5. LLM classification - Route based on intent analysis
     */
    router: async ({ network, input, lastResult }) => {
      const state = network.state.kv;

      // Priority 1: Check if work is complete - return undefined to stop the network
      if (state.get('complete')) {
        console.log('[router] Task complete, stopping network');
        state.delete('currentAgent');
        return undefined;
      }

      // Priority 2: User confirmed handoff from previous suggestion
      const handoffSuggested = state.get('handoff_suggested') as string | undefined;
      if (handoffSuggested && userConfirmsHandoff(input)) {
        state.delete('handoff_suggested');
        state.set('currentAgent', handoffSuggested);
        console.log('[router] User confirmed handoff to:', handoffSuggested);
        return handoffSuggested === 'coding' ? codingAgent : logAnalyzer;
      }
      // Clear stale handoff suggestion if user didn't confirm
      if (handoffSuggested) {
        state.delete('handoff_suggested');
      }

      // Priority 3: Check if an agent explicitly requested a handoff via state
      const nextAgent = state.get('route_to') as string | undefined;
      if (nextAgent) {
        state.delete('route_to');
        state.set('currentAgent', nextAgent);
        console.log('[router] Agent requested handoff to:', nextAgent);
        return nextAgent === 'coding' ? codingAgent : logAnalyzer;
      }

      // Priority 4: Sticky behavior - if an agent is already running, keep using it
      const currentAgent = state.get('currentAgent') as string | undefined;
      if (currentAgent && lastResult) {
        console.log('[router] Sticky: continuing with', currentAgent);
        return currentAgent === 'coding' ? codingAgent : logAnalyzer;
      }

      // Priority 5: LLM classification for all initial routing
      console.log('[router] Classifying intent with LLM');
      const routingDecision = await classifyIntentWithLLM(input);
      console.log('[router] LLM decision:', JSON.stringify(routingDecision));

      // Handle low confidence or unclear intent
      if (routingDecision.agent === 'unclear' || routingDecision.confidence < ROUTING_CONFIDENCE_THRESHOLD) {
        console.log('[router] Low confidence, requesting clarification');
        state.set('needs_clarification', true);
        state.set('currentAgent', 'log-analyzer'); // Default to read-only agent
        return logAnalyzer;
      }

      state.set('currentAgent', routingDecision.agent);
      return routingDecision.agent === 'coding' ? codingAgent : logAnalyzer;
    },
  });
}

