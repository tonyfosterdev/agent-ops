/**
 * Inngest Realtime Channel Definition for useAgents.
 *
 * Defines the channel structure for streaming agent events to the dashboard
 * using @inngest/use-agent's expected format.
 *
 * ## Channel Structure
 *
 * - Channel: `user:${userId}` - One channel per user
 * - Topic: `agent_stream` - All AgentKit streaming events
 *
 * AgentKit automatically publishes these event types via streaming.publish:
 * - `run.started`, `run.completed`, `run.failed`
 * - `part.created`, `part.completed` (text, tool-call, tool-output)
 * - `text.delta` (streaming text chunks)
 * - `hitl.requested`, `hitl.resolved` (approval flow)
 *
 * ## Usage
 *
 * Server (publish via streaming):
 * ```typescript
 * await agentNetwork.run(message, {
 *   state: runState,
 *   streaming: {
 *     publish: async (chunk) => {
 *       await publish(userChannel(userId).agent_stream(chunk));
 *     },
 *   },
 * });
 * ```
 *
 * Dashboard (subscribing via useAgents):
 * The useAgents hook automatically handles subscription via WebSocket token.
 */

import { channel, topic } from '@inngest/realtime';
import { z } from 'zod';

/**
 * Schema for AgentKit streaming chunks.
 * This matches the AgentMessageChunk format from @inngest/agent-kit.
 */
const AgentMessageChunkSchema = z.object({
  event: z.string(),
  data: z.unknown(),
  timestamp: z.number().optional(),
  sequenceNumber: z.number().optional(),
  id: z.string().optional(),
});

/**
 * Channel factory for user-scoped streaming.
 *
 * Creates channels in the format `user:${userId}` which the useAgents hook
 * subscribes to via the WebSocket token from /api/realtime/token.
 *
 * @param userId - User identifier for channel scoping
 * @returns Channel with agent_stream topic
 */
export const userChannel = channel((userId: string) => `user:${userId}`)
  .addTopic(topic('agent_stream').schema(AgentMessageChunkSchema));

/**
 * The topic name for agent streaming events.
 */
export const AGENT_STREAM_TOPIC = 'agent_stream';
