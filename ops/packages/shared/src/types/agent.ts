/**
 * Core agent types and interfaces
 */

/**
 * Agent configuration interface
 */
export interface AgentConfig {
  apiKey: string;
  maxSteps: number;
  model: string;
  workDir: string;
  logLevel: 'info' | 'debug' | 'error';
  agentType: 'coding' | 'log-analyzer' | 'orchestration';
}

/**
 * Agent execution trace for debugging and auditing
 */
export interface AgentExecutionTrace {
  step: number;
  reasoning: string;
  action: string;
  observation: string;
  isComplete: boolean;
}

/**
 * Result returned after agent completes task
 */
export interface AgentResult {
  success: boolean;
  message: string;
  steps: number;
  trace: AgentExecutionTrace[];
}

/**
 * Agent lifecycle hooks for initialization, cleanup, etc.
 */
export interface AgentLifecycle {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
