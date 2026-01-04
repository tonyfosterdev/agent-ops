/**
 * Inngest Functions for AgentOps.
 *
 * Defines durable functions that execute agent workflows. These functions
 * leverage Inngest's step functions for automatic durability - if the
 * server crashes or restarts, execution resumes from the last completed step.
 *
 * ## Functions
 *
 * - agentChat: Main chat function that runs the agent network
 *
 * ## HITL Integration
 *
 * Run context (runId, threadId) is passed through network.run() via state.
 * Tools access these values from network.state.kv during execution. This
 * approach is concurrency-safe because each network.run() gets its own
 * state instance.
 *
 * When a tool requires approval, it uses:
 *
 * ```typescript
 * await step.waitForEvent('agentops/tool.approval', {
 *   match: 'data.toolCallId',
 *   timeout: '4h',
 * });
 * ```
 *
 * The dashboard sends approval events via the Inngest client:
 *
 * ```typescript
 * await inngest.send({
 *   name: 'agentops/tool.approval',
 *   data: { runId, toolCallId, approved: true },
 * });
 * ```
 */

import { createState } from '@inngest/agent-kit';
import { inngest } from '../inngest.js';
import { agentNetwork } from '../network.js';
import { historyAdapter } from '../db/index.js';

/**
 * Main chat function that runs the agent network.
 *
 * Triggered by 'agent/chat' events from the dashboard or API.
 * Retrieves conversation history, runs the network, and persists results.
 *
 * Event data:
 * - threadId: UUID of the conversation thread
 * - message: User's message to process
 * - userId: Optional user identifier for audit
 */
export const agentChat = inngest.createFunction(
  {
    id: 'agent-chat',
    // Retry configuration for transient failures
    retries: 3,
  },
  { event: 'agent/chat' },
  async ({ event, step }) => {
    const { threadId, message, userId } = event.data;

    // Create a fresh state instance for this run with correlation IDs
    // This is concurrency-safe: each network.run() gets its own state
    // Tools access these values via network.state.kv during execution
    const runState = createState({
      runId: event.id,
      threadId,
      userId,
    });

    // Retrieve conversation history from database
    const history = await step.run('get-history', async () => {
      const messages = await historyAdapter.get(threadId);
      // Convert stored messages to AgentKit history format
      return messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: msg.content,
      }));
    });

    // Append the user's message to history before running
    await step.run('store-user-message', async () => {
      await historyAdapter.appendMessage(threadId, 'user', message);
    });

    // Run the agent network with the full conversation context
    // The network will route between agents based on the hybrid router
    // State includes run context for HITL correlation (runId, threadId)
    // Note: step tools are automatically available via Inngest's async context
    const networkRun = await agentNetwork.run(message, {
      state: runState,
    });

    // Get the results from the network run
    const results = networkRun.state.results;

    // Persist agent responses to the database
    await step.run('store-agent-messages', async () => {
      // Convert network results to history format
      const agentMessages = results.flatMap((result) =>
        result.output.map((output) => ({
          role: 'assistant' as const,
          content: output,
          agentName: result.agentName,
        }))
      );

      await historyAdapter.appendResults(threadId, agentMessages);
    });

    // No need to clear state - each run has its own state instance

    return {
      success: true,
      threadId,
      resultCount: results.length,
    };
  }
);

/**
 * All Inngest functions for registration with the serve handler.
 */
export const inngestFunctions = [agentChat];
