/**
 * AgentKit agents barrel export.
 *
 * This module exports all available agent factories for use with AgentKit networks.
 * Each agent is specialized for a particular domain:
 *
 * - createCodingAgent: Code analysis, debugging, and repairs (uses dangerous tools)
 * - createLogAnalyzer: Log parsing, pattern detection, and diagnostics (safe tools only)
 *
 * ## Factory Pattern
 *
 * All agents are now created via factory functions that accept a FactoryContext.
 * This allows the publish function to be injected for HITL events:
 *
 * ```typescript
 * const codingAgent = createCodingAgent({ publish });
 * const logAnalyzer = createLogAnalyzer({ publish });
 * ```
 *
 * The network uses LLM-only routing for intent classification to ensure
 * correctness. All initial routing decisions go through Claude 3.5 Haiku.
 */
export { createCodingAgent } from './coding';
export { createLogAnalyzer } from './log-analyzer';

// Re-export types
export type { FactoryContext } from '../tools/types';
