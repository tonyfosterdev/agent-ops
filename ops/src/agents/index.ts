/**
 * AgentKit agents barrel export.
 *
 * This module exports all available agents for use with AgentKit networks.
 * Each agent is specialized for a particular domain:
 *
 * - codingAgent: Code analysis, debugging, and repairs
 * - logAnalyzer: Log parsing, pattern detection, and diagnostics
 *
 * Note: AgentKit provides getDefaultRoutingAgent() for LLM-based routing,
 * so no "default" agent is needed here. The network uses a hybrid routing
 * approach: code-based rules first, then LLM fallback via getDefaultRoutingAgent().
 */
export { codingAgent } from './coding.js';
export { logAnalyzer } from './log-analyzer.js';

// Re-export as array for convenient network registration
import { codingAgent } from './coding.js';
import { logAnalyzer } from './log-analyzer.js';

/**
 * All available agents for network registration.
 */
export const agents = [codingAgent, logAnalyzer];
