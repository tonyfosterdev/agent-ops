/**
 * Type definitions for agent streaming events.
 *
 * These types mirror the server-side AgentStreamEvent types from
 * ops/src/inngest/realtime.ts. They define the shape of events
 * received via the Inngest Realtime subscription.
 */

/**
 * Event published when agent run begins.
 */
export interface RunStartedEvent {
  type: 'run.started';
  runId: string;
  threadId: string;
}

/**
 * Event published when a tool is called.
 *
 * For HITL tools, this is published BEFORE waitForEvent,
 * allowing the dashboard to show the approval UI immediately.
 */
export interface ToolCallEvent {
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

/**
 * Event published after tool execution completes.
 */
export interface ToolResultEvent {
  type: 'tool.result';
  toolCallId: string;
  result: unknown;
  isError: boolean;
  /** Feedback provided when tool was rejected */
  rejectionFeedback?: string;
}

/**
 * Event published when agent run completes successfully.
 */
export interface RunCompleteEvent {
  type: 'run.complete';
  runId: string;
}

/**
 * Event published when agent run fails.
 */
export interface RunErrorEvent {
  type: 'run.error';
  runId: string;
  error: string;
}

/**
 * Union type of all possible agent stream events.
 */
export type AgentStreamEvent =
  | RunStartedEvent
  | ToolCallEvent
  | ToolResultEvent
  | RunCompleteEvent
  | RunErrorEvent;

/**
 * Pending tool approval state derived from stream events.
 *
 * Created when a tool.call event with requiresApproval=true is received.
 * Cleared when the corresponding tool.result event arrives.
 */
export interface PendingApproval {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason?: string;
  agentName?: string;
}

/**
 * Message part types for rendering in the UI.
 *
 * These are derived from stream events and stored in message state.
 */
export type StreamMessagePart =
  | { type: 'text'; content: string }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      args: Record<string, unknown>;
      requiresApproval: boolean;
      status: 'pending' | 'approved' | 'rejected' | 'completed';
      reason?: string;
    }
  | {
      type: 'tool-result';
      toolCallId: string;
      result: unknown;
      isError: boolean;
      rejectionFeedback?: string;
    };

/**
 * Message structure for streaming chat UI.
 */
export interface StreamMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts?: StreamMessagePart[];
  agentName?: string;
  createdAt: string;
  /** The Inngest run ID that produced this message */
  runId?: string;
}

/**
 * State machine status for agent stream subscription.
 */
export type StreamStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'running'
  | 'error';
