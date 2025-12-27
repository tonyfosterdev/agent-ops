// Shared types for the dashboard

export type AgentType = 'orchestrator' | 'coding' | 'log-analyzer';

export type RunStatus = 'pending' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';

export type JournalEventType =
  | 'RUN_STARTED'
  | 'AGENT_THOUGHT'
  | 'TOOL_PROPOSED'
  | 'RUN_SUSPENDED'
  | 'RUN_RESUMED'
  | 'TOOL_RESULT'
  | 'RUN_COMPLETED'
  | 'SYSTEM_ERROR'
  | 'CHILD_RUN_STARTED'
  | 'CHILD_RUN_COMPLETED'
  | 'RUN_CANCELLED';

export interface JournalEvent {
  id: string;
  sequence: number;
  type: JournalEventType;
  payload: Record<string, unknown>;
  created_at: string;
  source_run_id?: string;
  source_agent_type?: string;
}

export interface PendingTool {
  tool_name: string;
  args: Record<string, unknown>;
  call_id: string;
}

export interface Run {
  id: string;
  user_id: string;
  prompt: string;
  status: RunStatus;
  current_step: number;
  agent_type: AgentType;
  parent_run_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  pending_tool?: PendingTool | null;
  events?: JournalEvent[];
}
