/**
 * Inngest client configuration for AgentOps.
 *
 * This client is used by all Inngest functions and the AgentKit network
 * to coordinate durable execution and event-driven workflows.
 */
import { Inngest } from 'inngest';
import { config } from './config.js';

/**
 * Custom event types for the AgentOps application.
 * These define the shape of events used in the system.
 */
type AgentOpsEvents = {
  // Triggered when a user sends a chat message
  'agent/chat': {
    data: {
      threadId: string;
      message: string;
      userId?: string;
    };
  };
  // Approval/rejection events for HITL tool calls
  'agentops/tool.approval': {
    data: {
      runId: string;
      toolCallId: string;
      approved: boolean;
      feedback?: string;
    };
  };
};

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
export const inngest = new Inngest<{ events: AgentOpsEvents }>({
  id: 'agentops',
  // Event key is optional in dev mode but required for production
  ...(config.inngest.eventKey && { eventKey: config.inngest.eventKey }),
});

export type { AgentOpsEvents };
