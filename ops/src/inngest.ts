/**
 * Inngest client configuration for AgentOps.
 *
 * This client is used by all Inngest functions and the AgentKit network
 * to coordinate durable execution and event-driven workflows.
 *
 * Includes realtimeMiddleware for streaming updates to the dashboard
 * via Inngest's realtime infrastructure.
 *
 * Event Schema:
 * - 'agent/chat.requested': Triggered by useAgents when user sends a message
 * - 'agentops/tool.approval': HITL approval/rejection for tool calls
 */
import { Inngest, EventSchemas } from 'inngest';
import { realtimeMiddleware } from '@inngest/realtime/middleware';
import { extendedTracesMiddleware } from 'inngest/experimental';
import { config } from './config';

/**
 * Custom event schemas for the AgentOps application.
 *
 * These define the shape of events used in the system. The 'agent/chat.requested'
 * event matches the format expected by @inngest/use-agent hook.
 */
const agentOpsEventSchemas = new EventSchemas().fromRecord<{
  // useAgents sends this event format when user sends a message
  'agent/chat.requested': {
    data: {
      /** Optional thread ID for conversation continuity */
      threadId?: string;
      /** User message with ID, content, and role */
      userMessage: {
        id: string;
        content: string;
        role: 'user';
      };
      /** User identifier for channel scoping */
      userId: string;
      /** Channel key for realtime subscription (defaults to userId) */
      channelKey?: string;
      /** Conversation history for context */
      history?: Array<{ role: string; content: string }>;
    };
  };
  // HITL approval/rejection events for tool calls
  'agentops/tool.approval': {
    data: {
      /** Tool call ID for correlation */
      toolCallId: string;
      /** Whether the tool execution is approved */
      approved: boolean;
      /** Optional feedback from user */
      feedback?: string;
    };
  };
}>();

/**
 * The main Inngest client for AgentOps.
 *
 * Configuration:
 * - id: Unique identifier for this application
 * - eventKey: API key for sending events (uses INNGEST_EVENT_KEY env var)
 *
 * In development, this connects to the Inngest Dev Server at localhost:8288.
 * In production, it connects to Inngest Cloud.
 */
export const inngest = new Inngest({
  id: 'agentops',
  schemas: agentOpsEventSchemas,
  // Event key is optional in dev mode but required for production
  ...(config.inngest.eventKey && { eventKey: config.inngest.eventKey }),
  // Enable realtime streaming for dashboard updates
  // extendedTracesMiddleware captures step.run() as OpenTelemetry spans
  // extendedTracesMiddleware with behaviour: "off" since we have auto-instrumentations in telemetry.ts
  // This still enables step-level tracing without duplicate HTTP/DB instrumentation
  middleware: [realtimeMiddleware(), extendedTracesMiddleware({ behaviour: 'off' })],
});
