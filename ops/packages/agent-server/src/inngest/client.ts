/**
 * Inngest Client Configuration
 *
 * Central Inngest client with telemetry middleware for durable agent execution.
 * This client is used throughout the agent-server for sending events and
 * defining functions.
 *
 * @see https://www.inngest.com/docs
 */

import { Inngest, EventSchemas } from 'inngest';
import { extendedTracesMiddleware } from 'inngest/experimental';
import type { AgentType } from '../types/journal';

/**
 * Event payload types for agent run lifecycle
 *
 * These events drive the durable execution of agent runs:
 * - agent/run.started: Triggers a new agent run
 * - agent/run.resumed: Resumes a suspended run after HITL approval
 * - agent/run.cancelled: Cancels an in-flight run
 */
interface AgentRunStarted {
  name: 'agent/run.started';
  data: {
    runId: string;
    prompt: string;
    userId: string;
    agentType: AgentType;
    parentRunId?: string;
  };
}

interface AgentRunResumed {
  name: 'agent/run.resumed';
  data: {
    runId: string;
    decision: 'approved' | 'rejected';
    feedback?: string;
  };
}

interface AgentRunCancelled {
  name: 'agent/run.cancelled';
  data: {
    runId: string;
    reason?: string;
  };
}

// Union type for all agent events
type AgentEvents = AgentRunStarted | AgentRunResumed | AgentRunCancelled;

/**
 * Type-safe event schemas for Inngest
 *
 * This provides compile-time type checking for event payloads
 * when using inngest.send() or defining function triggers.
 */
const eventSchemas = new EventSchemas().fromUnion<AgentEvents>();

/**
 * Inngest client instance
 *
 * Configuration:
 * - id: Unique identifier for this application (used for function namespacing)
 * - schemas: Type-safe event definitions
 * - middleware: Extended traces for better observability in Inngest Dev Server
 *
 * The extendedTracesMiddleware provides detailed step-level tracing without
 * requiring external OTel infrastructure - it works with Inngest's built-in
 * tracing in the Dev Server.
 */
export const inngest = new Inngest({
  id: 'agent-server',
  schemas: eventSchemas,
  middleware: [extendedTracesMiddleware()],
});

// Export event types for use in other modules
export type { AgentRunStarted, AgentRunResumed, AgentRunCancelled, AgentEvents };
