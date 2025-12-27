/**
 * Agent Definition Registry
 *
 * Central registry for loading agent definitions by type.
 */

import type { AgentDefinition, AgentType } from '../types';
import { orchestratorDefinition } from './orchestrator';
import { codingDefinition } from './coding';
import { logAnalyzerDefinition } from './log-analyzer';

const definitions: Record<AgentType, AgentDefinition> = {
  orchestrator: orchestratorDefinition,
  coding: codingDefinition,
  'log-analyzer': logAnalyzerDefinition,
};

/**
 * Load an agent definition by type
 * @throws Error if agent type is unknown
 */
export function loadAgentDefinition(agentType: AgentType): AgentDefinition {
  const def = definitions[agentType];
  if (!def) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }
  return def;
}
