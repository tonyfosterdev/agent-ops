/**
 * Inngest Realtime Channel and Topic Definitions.
 *
 * Defines the channel structure for streaming agent events to the dashboard.
 * Each conversation thread gets its own channel, scoped by threadId.
 *
 * ## Channel Structure
 *
 * - Channel: `thread:{threadId}` - One channel per conversation thread
 * - Topic: `agent_stream` - All agent events flow through this topic
 *
 * ## Event Types
 *
 * Events published to the stream:
 * - `run.started` - Agent run begins
 * - `tool.call` - Agent invokes a tool (includes HITL info if approval needed)
 * - `tool.result` - Tool execution completed
 * - `run.complete` - Agent run finished successfully
 * - `run.error` - Agent run failed
 *
 * ## Future Event Types (Deferred)
 *
 * The following event type is reserved for future implementation:
 * - `text.delta` - Token-level streaming of assistant responses
 *
 * Token-level streaming requires AgentKit's onToken callback support which is
 * not yet available. When implemented, text.delta events will allow real-time
 * display of assistant responses as they are generated, rather than waiting
 * for the complete response.
 *
 * ## Usage
 *
 * Server (publishing):
 * ```typescript
 * const channel = getAgentChannel(threadId);
 * publish({ channel, topic: 'agent_stream', data: { type: 'run.started', runId } });
 * ```
 *
 * Dashboard (subscribing):
 * ```typescript
 * const token = await getSubscriptionToken(inngest, {
 *   channel: getAgentChannel(threadId),
 *   topics: ['agent_stream'],
 * });
 * ```
 */

/**
 * Event types that can be published to the agent stream.
 *
 * These events are consumed by the dashboard to update the UI in real-time.
 */
export type AgentStreamEvent =
  | {
      type: 'run.started';
      runId: string;
      threadId: string;
    }
  | {
      type: 'tool.call';
      toolName: string;
      toolCallId: string;
      args: unknown;
      /** Whether this tool requires human approval before execution */
      requiresApproval: boolean;
      /** ID used to match approval events (same as toolCallId for HITL tools) */
      approvalRequestId?: string;
      /** Human-readable reason why this tool needs to run */
      reason?: string;
      /** Name of the agent that invoked this tool */
      agentName?: string;
    }
  | {
      type: 'tool.result';
      toolCallId: string;
      result: unknown;
      isError: boolean;
      /** Feedback provided when tool was rejected */
      rejectionFeedback?: string;
    }
  | {
      type: 'run.complete';
      runId: string;
    }
  | {
      type: 'run.error';
      runId: string;
      error: string;
    };

/**
 * Create a channel name for a specific thread.
 *
 * Each conversation thread has its own channel to isolate streaming events.
 * This ensures users only receive events for threads they have access to.
 *
 * @param threadId - UUID of the conversation thread
 * @returns Channel name in format `thread:{threadId}`
 */
export function getAgentChannel(threadId: string): string {
  return `thread:${threadId}`;
}

/**
 * The topic name for agent streaming events.
 *
 * All agent events (tool calls, results, completions) flow through
 * this single topic within each thread's channel.
 */
export const AGENT_STREAM_TOPIC = 'agent_stream';

/**
 * Get channel configuration for agent streaming.
 *
 * Creates thread-scoped channel reference for use with getSubscriptionToken().
 * The channel is just a string, and topics specify what events to subscribe to.
 *
 * @param threadId - Thread UUID to scope the channel
 * @returns Channel string
 */
export function agentChannel({ threadId }: { threadId: string }): string {
  return getAgentChannel(threadId);
}

/**
 * Type-safe publish helper for agent stream events.
 *
 * Ensures events are correctly typed when publishing to the stream.
 *
 * @param publish - The publish function from Inngest function context
 * @param threadId - Thread to publish to
 * @param event - The event to publish
 */
export function publishToThread(
  publish: (opts: { channel: string; topic: string; data: AgentStreamEvent }) => void,
  threadId: string,
  event: AgentStreamEvent
): void {
  publish({
    channel: getAgentChannel(threadId),
    topic: AGENT_STREAM_TOPIC,
    data: event,
  });
}
