/**
 * AgentKit tools barrel export.
 *
 * This module exports all available tools for use with AgentKit agents.
 * Tools are organized into categories:
 *
 * - File Tools: Read-only file operations (no HITL required)
 * - Shell Tools: Shell command execution (HITL required)
 * - Write Tools: File writing operations (HITL required)
 * - Loki Tools: Log querying from Grafana Loki (no HITL required)
 * - State Tools: Network state mutation for agent communication (no HITL required)
 * - Security: Validation utilities for defense-in-depth
 */

// File operation tools (read-only, no HITL)
export {
  readFileTool,
  findFilesTool,
  searchCodeTool,
  fileTools,
} from './file-tools.js';

// Shell execution tools (HITL required)
export {
  shellExecuteTool,
  shellTools,
  shellToolMetadata,
  type HitlPendingResult,
} from './shell-tools.js';

// File writing tools (HITL required)
export {
  writeFileTool,
  appendFileTool,
  writeTools,
  writeToolMetadata,
} from './write-tools.js';

// Loki log query tools (read-only, no HITL)
export {
  lokiQueryTool,
  lokiLabelsTool,
  lokiLabelValuesTool,
  lokiTools,
} from './loki-tools.js';

// State mutation tools (no HITL - these modify network state, not system state)
export {
  reportFindingsTool,
  completeTaskTool,
  stateTools,
} from './state-tools.js';

// Security utilities for defense-in-depth validation
export {
  validateCommand,
  validatePath,
  getWorkspaceRoot,
  ALLOWED_COMMANDS,
  type ValidationResult,
  type PathValidationResult,
} from './security.js';

// Import for aggregation
import { fileTools as _fileTools } from './file-tools.js';
import { shellTools as _shellTools, shellToolMetadata as _shellMeta } from './shell-tools.js';
import { writeTools as _writeTools, writeToolMetadata as _writeMeta } from './write-tools.js';
import { lokiTools as _lokiTools } from './loki-tools.js';
import { stateTools as _stateTools } from './state-tools.js';

/**
 * All standard tools (no HITL required).
 *
 * These tools are safe for autonomous agent operation as they
 * only read data and do not modify system state. State tools are
 * included here because they only modify network state (for agent
 * communication), not external system state.
 */
export const standardTools = [
  // File operations
  ..._fileTools,
  // Loki queries
  ..._lokiTools,
  // State mutation (network state only, no external side effects)
  ..._stateTools,
];

/**
 * All dangerous tools (HITL required).
 *
 * These tools modify system state and require explicit human
 * approval before execution.
 */
export const dangerousTools = [
  // Shell execution
  ..._shellTools,
  // File writing
  ..._writeTools,
];

/**
 * All available tools.
 *
 * Includes both standard (safe) and dangerous (HITL) tools.
 * Use with caution - dangerous tools will pause for approval.
 */
export const allTools = [...standardTools, ...dangerousTools];

/**
 * Metadata for dangerous tools.
 *
 * Maps tool names to their metadata including:
 * - requiresApproval: Whether HITL is required
 * - riskLevel: low, medium, or high
 * - description: Human-readable description
 *
 * Use this metadata in the agent layer to determine which
 * tools need human approval before execution.
 */
export const dangerousToolMetadata = {
  ..._shellMeta,
  ..._writeMeta,
};

/**
 * List of tool names that require HITL approval.
 */
export const toolsRequiringApproval = Object.keys(dangerousToolMetadata);

/**
 * Check if a tool requires human approval.
 */
export function requiresApproval(toolName: string): boolean {
  return toolName in dangerousToolMetadata;
}
