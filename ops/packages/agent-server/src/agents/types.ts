/**
 * Agent Definition Interface
 *
 * Pure configuration-based agent definitions for hierarchical multi-agent system.
 */

import type { CoreTool } from 'ai';
import type { AgentType } from '../types/journal';

export type { AgentType };

/**
 * Context provided to agent tools at runtime
 */
export interface ToolContext {
  workDir: string;
  lokiUrl: string;
  runId: string;
  parentRunId?: string;
}

/**
 * Agent definition interface - pure configuration
 * Each agent type implements this to provide its prompt and tools
 */
export interface AgentDefinition {
  readonly agentType: AgentType;
  getSystemPrompt(): string;
  getTools(context: ToolContext): Record<string, CoreTool>;
}
