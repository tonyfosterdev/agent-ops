/**
 * API types for client-server communication
 */

export interface RunAgentRequest {
  task: string;
  config?: {
    maxSteps?: number;
    model?: string;
    workDir?: string;
  };
}

export interface RunAgentResponse {
  // SSE stream - no direct response body
}

export interface AgentTypeInfo {
  type: 'coding' | 'log-analyzer' | 'orchestration';
  description: string;
}

export interface ListAgentsResponse {
  agents: AgentTypeInfo[];
}

export interface HealthResponse {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
}

export interface ErrorResponse {
  error: string;
  message?: string;
  details?: any;
}
