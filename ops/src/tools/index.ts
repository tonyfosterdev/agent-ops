/**
 * AgentKit tools barrel export.
 *
 * This module exports all available tools for use with AgentKit agents.
 * Tools are organized into categories:
 *
 * - File Tools: Read-only file operations (no HITL required)
 * - Shell Tools: Shell command execution (HITL required) - factory pattern
 * - Write Tools: File writing operations (HITL required) - factory pattern
 * - Docker Tools: Docker operations (HITL required) - factory pattern
 * - Loki Tools: Log querying from Grafana Loki (no HITL required)
 * - State Tools: Network state mutation for agent communication (no HITL required)
 * - Security: Validation utilities for defense-in-depth
 *
 * ## Factory Pattern
 *
 * Dangerous tools (shell, write, docker) use the factory pattern to receive
 * a publish function for emitting HITL events. Create these tools by passing
 * a FactoryContext:
 *
 * ```typescript
 * const dangerousTools = [
 *   ...createShellTools({ publish }),
 *   ...createWriteTools({ publish }),
 *   ...createDockerTools({ publish }),
 * ];
 * ```
 */

// Shared types for factory pattern
export type { FactoryContext, StreamingPublishFn } from './types.js';
export { createHitlRequestedEvent } from './types.js';

// File operation tools (read-only, no HITL)
export {
  readFileTool,
  findFilesTool,
  searchCodeTool,
  fileTools,
} from './file-tools.js';

// Shell execution tools (HITL required) - factory pattern
export {
  createShellExecuteTool,
  createShellTools,
  shellToolMetadata,
  type HitlPendingResult,
} from './shell-tools.js';

// File writing tools (HITL required) - factory pattern
export {
  createWriteFileTool,
  createAppendFileTool,
  createWriteTools,
  writeToolMetadata,
} from './write-tools.js';

// Docker Compose tools (HITL required) - factory pattern
export {
  createDockerComposeRestartTool,
  createDockerTools,
  dockerToolMetadata,
} from './docker-tools.js';

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
  validateServiceRestart,
  getWorkspaceRoot,
  getComposeFilePath,
  ALLOWED_COMMANDS,
  ALLOWED_SERVICES,
  type ValidationResult,
  type PathValidationResult,
  type AllowedService,
} from './security.js';

// Import for aggregation
import { fileTools as _fileTools } from './file-tools.js';
import { shellToolMetadata as _shellMeta } from './shell-tools.js';
import { writeToolMetadata as _writeMeta } from './write-tools.js';
import { dockerToolMetadata as _dockerMeta } from './docker-tools.js';
import { lokiTools as _lokiTools } from './loki-tools.js';
import { stateTools as _stateTools } from './state-tools.js';
import { createShellTools as _createShellTools } from './shell-tools.js';
import { createWriteTools as _createWriteTools } from './write-tools.js';
import { createDockerTools as _createDockerTools } from './docker-tools.js';
import type { FactoryContext } from './types.js';

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
 * Create all dangerous tools with publish function injected.
 *
 * These tools modify system state and require explicit human
 * approval before execution. The factory pattern ensures each
 * tool has access to the publish function for HITL events.
 *
 * @param context - Factory context with publish function
 * @returns Array of all dangerous tools
 */
export function createDangerousTools(context: FactoryContext) {
  return [
    // Shell execution
    ..._createShellTools(context),
    // File writing
    ..._createWriteTools(context),
    // Docker operations
    ..._createDockerTools(context),
  ];
}

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
  ..._dockerMeta,
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
