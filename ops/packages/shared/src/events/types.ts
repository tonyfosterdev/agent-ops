/**
 * Event types for agent execution
 * These events allow decoupling of agent logic from UI rendering
 */

import type { AgentResult } from '../types';

/**
 * All possible agent event types
 */
export type AgentEventType =
  | 'agent:start'           // Agent begins execution
  | 'agent:switch'          // Orchestration switches to sub-agent
  | 'agent:complete'        // Agent finishes successfully
  | 'agent:error'           // Agent encounters error
  | 'step:start'            // New reasoning step begins
  | 'step:text_chunk'       // Text streaming (word-by-word)
  | 'step:text_complete'    // Full text received
  | 'step:tool_call_streaming_start' // Tool call begins streaming (before args ready)
  | 'step:tool_call_start'  // Tool execution begins (args ready)
  | 'step:tool_call_complete' // Tool execution finishes
  | 'step:complete';        // Step finishes

/**
 * Base properties shared by all agent events
 */
export interface BaseAgentEvent {
  type: AgentEventType;
  timestamp: number;
  agentType: 'coding' | 'log-analyzer' | 'orchestration';
  agentId: string; // Unique ID for this agent instance
}

/**
 * Agent starts executing a task
 */
export interface AgentStartEvent extends BaseAgentEvent {
  type: 'agent:start';
  task: string;
  maxSteps: number;
  parentAgentId?: string; // For sub-agents (delegation)
}

/**
 * Orchestration agent switches to a sub-agent
 */
export interface AgentSwitchEvent extends BaseAgentEvent {
  type: 'agent:switch';
  fromAgent: string;
  toAgent: string;
  delegationTask: string;
}

/**
 * Agent completes execution
 */
export interface AgentCompleteEvent extends BaseAgentEvent {
  type: 'agent:complete';
  result: AgentResult;
}

/**
 * Agent encounters an error
 */
export interface AgentErrorEvent extends BaseAgentEvent {
  type: 'agent:error';
  error: string;
}

/**
 * A new step begins
 */
export interface StepStartEvent extends BaseAgentEvent {
  type: 'step:start';
  stepNumber: number;
}

/**
 * Text chunk received (for streaming display)
 */
export interface StepTextChunkEvent extends BaseAgentEvent {
  type: 'step:text_chunk';
  stepNumber: number;
  chunk: string; // Single character or small chunk
  isComplete: boolean;
}

/**
 * Full text for step received
 */
export interface StepTextCompleteEvent extends BaseAgentEvent {
  type: 'step:text_complete';
  stepNumber: number;
  text: string;
}

/**
 * Tool call begins streaming (before args are complete)
 */
export interface StepToolCallStreamingStartEvent extends BaseAgentEvent {
  type: 'step:tool_call_streaming_start';
  stepNumber: number;
  toolName: string;
  toolCallId: string;
}

/**
 * Tool call starts executing (args are now complete)
 */
export interface StepToolCallStartEvent extends BaseAgentEvent {
  type: 'step:tool_call_start';
  stepNumber: number;
  toolName: string;
  toolCallId: string;
  args: any;
}

/**
 * Tool call completes
 */
export interface StepToolCallCompleteEvent extends BaseAgentEvent {
  type: 'step:tool_call_complete';
  stepNumber: number;
  toolName: string;
  result: any;
  success: boolean;
  summary: string; // One-sentence description
}

/**
 * Step completes
 */
export interface StepCompleteEvent extends BaseAgentEvent {
  type: 'step:complete';
  stepNumber: number;
}

/**
 * Union type of all possible agent events
 */
export type AgentEvent =
  | AgentStartEvent
  | AgentSwitchEvent
  | AgentCompleteEvent
  | AgentErrorEvent
  | StepStartEvent
  | StepTextChunkEvent
  | StepTextCompleteEvent
  | StepToolCallStreamingStartEvent
  | StepToolCallStartEvent
  | StepToolCallCompleteEvent
  | StepCompleteEvent;
