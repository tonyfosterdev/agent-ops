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
 * ## Streaming with AgentKit
 *
 * Uses AgentKit's built-in streaming via `streaming.publish` in network.run().
 * All events (run.started, text.delta, tool-call, etc.) are automatically
 * published to the realtime channel for the useAgents hook to consume.
 *
 * ## History Management
 *
 * History is managed automatically by AgentKit's HistoryConfig in network.ts:
 * - createThread: Creates/ensures thread exists (supports client-generated IDs)
 * - get: Loads conversation history from database
 * - appendUserMessage: Saves user message at start of run
 * - appendResults: Saves agent results after run completes
 *
 * ## HITL Integration
 *
 * When a tool requires approval, it uses:
 *
 * ```typescript
 * await step.waitForEvent('agentops/tool.approval', {
 *   if: `async.data.toolCallId == "${toolCallId}"`,
 *   timeout: '4h',
 * });
 * ```
 *
 * The dashboard sends approval events via the Inngest client:
 *
 * ```typescript
 * await inngest.send({
 *   name: 'agentops/tool.approval',
 *   data: { toolCallId, approved: true },
 * });
 * ```
 */

import { createState } from '@inngest/agent-kit';
import { inngest } from '../inngest.js';
import { agentNetwork } from '../network.js';
import { AGENT_STREAM_TOPIC } from './realtime.js';

/**
 * Main chat function that runs the agent network.
 *
 * Triggered by 'agent/chat.requested' events from the useAgents hook.
 * Uses AgentKit streaming to push all events to the dashboard in real-time.
 *
 * History management is handled automatically by AgentKit's HistoryConfig:
 * - Thread creation: history.createThread (supports client or server-generated IDs)
 * - History loading: history.get
 * - User message persistence: history.appendUserMessage
 * - Agent result persistence: history.appendResults
 *
 * Event data:
 * - threadId: Optional UUID of the conversation thread (client-generated or omitted)
 * - userMessage: { id, content, role } - The user's message
 * - userId: User identifier for channel scoping and thread ownership
 * - channelKey: Optional override for realtime channel (defaults to userId)
 */
export const agentChat = inngest.createFunction(
  {
    id: 'agent-chat',
    // Retry configuration for transient failures
    retries: 3,
  },
  { event: 'agent/chat.requested' },
  async ({ event, publish }) => {
    const { threadId, userMessage, userId, channelKey } = event.data;
    const runId = event.id ?? `run-${Date.now()}`;

    // Use channelKey if provided, otherwise fall back to userId
    const subscriptionKey = channelKey || userId;

    // Create state with userId and optional threadId for history config to use
    // AgentKit's history.createThread handles thread creation/lookup
    const runState = createState({
      runId,
      threadId, // Pass through - AgentKit handles creation if missing
      userId,
    });

    // Build channel name for realtime publishing
    const channelName = `user:${subscriptionKey}`;

    // Run the agent network with streaming enabled
    // AgentKit now handles:
    // - Thread creation (if threadId missing) via history.createThread
    // - History loading via history.get
    // - User message persistence via history.appendUserMessage
    // - Result persistence via history.appendResults
    const networkRun = await agentNetwork.run(userMessage.content, {
      state: runState,
      streaming: {
        publish: async (chunk) => {
          // Publish to the user's realtime channel
          await publish({
            channel: channelName,
            topic: AGENT_STREAM_TOPIC,
            data: chunk,
          });
        },
      },
    });

    return {
      success: true,
      threadId: networkRun.state.threadId,
      resultCount: networkRun.state.results.length,
    };
  }
);

/**
 * All Inngest functions for registration with the serve handler.
 */
export const inngestFunctions = [agentChat];
