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
 * ## HITL Integration
 *
 * When a tool requires approval, the flow is:
 *
 * 1. Tool generates unique toolCallId (durably via step.run)
 * 2. Tool publishes hitl.requested event via the bound publish function
 * 3. Dashboard shows approval UI with approve/deny buttons
 * 4. Tool waits via step.waitForEvent('agentops/tool.approval')
 * 5. User clicks approve/deny -> server sends tool.approval event
 * 6. waitForEvent resolves, tool continues or returns rejection
 *
 * The publish function is injected into the network factory, which passes
 * it to agent factories, which pass it to tool factories.
 *
 * ## History Management
 *
 * History is managed automatically by AgentKit's HistoryConfig in network.ts:
 * - createThread: Creates/ensures thread exists (supports client-generated IDs)
 * - get: Loads conversation history from database
 * - appendUserMessage: Saves user message at start of run
 * - appendResults: Saves agent results after run completes
 */

import { createState, type AgentMessageChunk } from '@inngest/agent-kit';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { inngest } from '../inngest.js';
import { createAgentNetwork } from '../network.js';
import { AGENT_STREAM_TOPIC } from './realtime.js';
import type { StreamingPublishFn } from '../tools/types.js';

/**
 * OpenTelemetry tracer for AgentKit operations.
 * Used to create custom spans for network runs and other agent operations.
 */
const tracer = trace.getTracer('agentkit');

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

    // Build channel name for realtime publishing
    const channelName = `user:${subscriptionKey}`;

    // Sequence counter for event ordering
    let sequenceNumber = 0;

    /**
     * Create bound publish function for tools.
     *
     * This wrapper adds the auto-generated fields (timestamp, sequenceNumber, id)
     * that are omitted from the StreamingPublishFn type. It also handles
     * publishing to the correct realtime channel.
     */
    const boundPublish: StreamingPublishFn = async (chunk) => {
      sequenceNumber += 1;
      await publish({
        channel: channelName,
        topic: AGENT_STREAM_TOPIC,
        data: {
          ...chunk,
          timestamp: Date.now(),
          sequenceNumber,
          id: `${chunk.event}-${Date.now()}-${sequenceNumber}`,
        },
      });
    };

    // Create network with publish function injected
    // This flows down to agents and tools for HITL events
    const agentNetwork = createAgentNetwork({ publish: boundPublish });

    // Create state with userId and optional threadId for history config to use
    // AgentKit's history.createThread handles thread creation/lookup
    const runState = createState({
      runId,
      threadId, // Pass through - AgentKit handles creation if missing
      userId,
    });

    // Run the agent network with streaming enabled, wrapped in OpenTelemetry span
    // AgentKit now handles:
    // - Thread creation (if threadId missing) via history.createThread
    // - History loading via history.get
    // - User message persistence via history.appendUserMessage
    // - Result persistence via history.appendResults
    const result = await tracer.startActiveSpan(
      'agentkit.network.run',
      {
        attributes: {
          'agentkit.thread_id': threadId ?? 'pending',
          'agentkit.user_id': userId,
          'agentkit.run_id': runId,
        },
      },
      async (span) => {
        try {
          const networkRun = await agentNetwork.run(userMessage.content, {
            state: runState,
            streaming: {
              publish: async (chunk: AgentMessageChunk) => {
                sequenceNumber += 1;
                // Publish to the user's realtime channel
                await publish({
                  channel: channelName,
                  topic: AGENT_STREAM_TOPIC,
                  data: {
                    ...chunk,
                    sequenceNumber,
                  },
                });
              },
            },
          });

          // Add result attributes to span
          span.setAttributes({
            'agentkit.result_count': networkRun.state.results.length,
            'agentkit.final_thread_id': networkRun.state.threadId ?? 'unknown',
          });
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            success: true,
            threadId: networkRun.state.threadId,
            resultCount: networkRun.state.results.length,
          };
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      }
    );

    return result;
  }
);

/**
 * All Inngest functions for registration with the serve handler.
 */
export const inngestFunctions = [agentChat];
