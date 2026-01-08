/**
 * Shared types for tool factories.
 *
 * These types support the factory pattern for injecting the publish function
 * into tools that require HITL (Human-in-the-Loop) approval. Tools need publish
 * to send hitl.requested events to the dashboard before waiting for approval.
 *
 * ## Architecture
 *
 * The publish function comes from Inngest's realtime channel:
 *
 * ```typescript
 * const agentChat = inngest.createFunction(..., async ({ publish }) => {
 *   // 'publish' sends to realtime channels
 *   const network = createAgentNetwork({ publish: boundPublish });
 * });
 * ```
 *
 * ## HITL Flow
 *
 * 1. Tool generates unique toolCallId (durably via step.run)
 * 2. Tool publishes hitl.requested event via publish()
 * 3. Dashboard shows approval UI
 * 4. Tool waits via step.waitForEvent()
 * 5. User approves/denies -> Inngest sends tool.approval event
 * 6. waitForEvent resolves, tool continues or returns rejection
 */

import type { HitlRequestedEvent, HitlResolvedEvent, AgentMessageChunk } from '@inngest/agent-kit';

/**
 * Publish function for streaming events to realtime channels.
 *
 * This is a bound version of Inngest's publish that omits auto-generated fields
 * (timestamp, sequenceNumber, id) which are added by the wrapper in functions.ts.
 */
export type StreamingPublishFn = (
  event: Omit<AgentMessageChunk, 'timestamp' | 'sequenceNumber' | 'id'>
) => Promise<void>;

/**
 * Context passed to tool/agent/network factories.
 *
 * Contains the bound publish function for sending HITL events.
 */
export interface FactoryContext {
  publish: StreamingPublishFn;
}

/**
 * Helper to create a properly typed hitl.requested event.
 *
 * This creates the event payload without the auto-generated fields
 * (timestamp, sequenceNumber, id) which are added by the publish wrapper.
 *
 * @param data - The HITL request data (requestId, runId, toolCalls, etc.)
 * @returns Event object ready for publishing
 *
 * @example
 * ```typescript
 * await publish(createHitlRequestedEvent({
 *   requestId: toolCallId,
 *   runId,
 *   toolCalls: [{
 *     partId: toolCallId,
 *     toolName: 'shell_command_execute',
 *     toolInput: { command, reason },
 *   }],
 *   expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
 *   metadata: { reason, riskLevel: 'high' },
 * }));
 * ```
 */
export function createHitlRequestedEvent(
  data: HitlRequestedEvent['data']
): Omit<HitlRequestedEvent, 'timestamp' | 'sequenceNumber' | 'id'> {
  return { event: 'hitl.requested', data };
}

/**
 * Helper to create a properly typed hitl.resolved event.
 *
 * This creates the event payload without the auto-generated fields
 * (timestamp, sequenceNumber, id) which are added by the publish wrapper.
 *
 * The `resolvedBy` field defaults to 'system' for automated resolution tracking.
 *
 * @param data - The HITL resolution data (requestId, runId, resolution, etc.)
 * @returns Event object ready for publishing
 *
 * @example
 * ```typescript
 * await publish(createHitlResolvedEvent({
 *   requestId: toolCallId,
 *   runId,
 *   resolution: approval?.data.approved ? 'approved' : 'denied',
 *   resolvedAt: new Date().toISOString(),
 * }));
 * ```
 */
export function createHitlResolvedEvent(
  data: Omit<HitlResolvedEvent['data'], 'resolvedBy'> & { resolvedBy?: string }
): Omit<HitlResolvedEvent, 'timestamp' | 'sequenceNumber' | 'id'> {
  return {
    event: 'hitl.resolved',
    data: {
      ...data,
      resolvedBy: data.resolvedBy ?? 'system',
    },
  };
}
