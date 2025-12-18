// Shared types for the dashboard

export type RunStatus = 'pending' | 'running' | 'suspended' | 'completed' | 'failed';

export type JournalEventType =
  | 'RUN_STARTED'
  | 'AGENT_THOUGHT'
  | 'TOOL_PROPOSED'
  | 'RUN_SUSPENDED'
  | 'RUN_RESUMED'
  | 'TOOL_RESULT'
  | 'RUN_COMPLETED'
  | 'SYSTEM_ERROR';

export interface JournalEvent {
  id: string;
  sequence: number;
  type: JournalEventType;
  payload: Record<string, unknown>;
  created_at: string;
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
  created_at: string;
  updated_at: string;
  completed_at?: string;
  pending_tool?: PendingTool | null;
  events?: JournalEvent[];
}
