/**
 * Durable Run Architecture - Type Definitions
 *
 * Event-sourced journal types for persistent agent runs with HITL support.
 */

// Run status states
export type RunStatus = 'pending' | 'running' | 'suspended' | 'completed' | 'failed';

// Journal event types (as specified in PLAN_PROMPT.md)
export type JournalEventType =
  | 'RUN_STARTED'
  | 'AGENT_THOUGHT'
  | 'TOOL_PROPOSED'
  | 'RUN_SUSPENDED'
  | 'RUN_RESUMED'
  | 'TOOL_RESULT'
  | 'RUN_COMPLETED'
  | 'SYSTEM_ERROR';

// Discriminated union for journal events
export type JournalEvent =
  | { type: 'RUN_STARTED'; payload: RunStartedPayload }
  | { type: 'AGENT_THOUGHT'; payload: AgentThoughtPayload }
  | { type: 'TOOL_PROPOSED'; payload: ToolProposedPayload }
  | { type: 'RUN_SUSPENDED'; payload: RunSuspendedPayload }
  | { type: 'RUN_RESUMED'; payload: RunResumedPayload }
  | { type: 'TOOL_RESULT'; payload: ToolResultPayload }
  | { type: 'RUN_COMPLETED'; payload: RunCompletedPayload }
  | { type: 'SYSTEM_ERROR'; payload: SystemErrorPayload };

// Event payload types
export interface RunStartedPayload {
  prompt: string;
  user_id: string;
}

export interface AgentThoughtPayload {
  text_content: string;
}

export interface ToolProposedPayload {
  tool_name: string;
  args: Record<string, unknown>;
  call_id: string;
}

export interface RunSuspendedPayload {
  reason: string;
}

export interface RunResumedPayload {
  decision: 'approved' | 'rejected';
  feedback?: string;
}

export interface ToolResultPayload {
  call_id: string;
  output_data: unknown;
  status: 'success' | 'error';
}

export interface RunCompletedPayload {
  summary: string;
}

export interface SystemErrorPayload {
  error_details: string;
}

// AgentReport interface for sub-agents (headless, JSON-only output)
export interface AgentReport {
  agent_type: 'log-analyzer' | 'coding';
  success: boolean;
  summary: string;
  findings: AgentFinding[];
  metadata?: Record<string, unknown>;
}

export interface AgentFinding {
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  evidence?: string;
  recommendation?: string;
}

// Tool classification
export const DANGEROUS_TOOLS = new Set([
  'shell_command_execute',
  'write_file',
]);

export const SAFE_TOOLS = new Set([
  'read_file',
  'find_files',
  'search_code',
  // Loki log query tools (read-only)
  'loki_query',
  'loki_labels',
  'loki_service_errors',
  // Log analyzer tools
  'analyze_logs',
  'generate_report',
]);

export function isDangerousTool(toolName: string): boolean {
  return DANGEROUS_TOOLS.has(toolName);
}

export function isSafeTool(toolName: string): boolean {
  return SAFE_TOOLS.has(toolName);
}
