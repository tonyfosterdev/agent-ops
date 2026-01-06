/**
 * Security utilities for tool validation.
 *
 * Provides defense-in-depth by validating commands and paths BEFORE
 * they are sent for HITL approval. This prevents obviously dangerous
 * commands from even reaching the approval queue.
 */

import * as path from 'node:path';

/**
 * Allowed command prefixes - commands must start with one of these.
 * This allowlist provides defense-in-depth alongside HITL approval.
 */
export const ALLOWED_COMMANDS = [
  // File operations (read-only or safe)
  'cat',
  'ls',
  'pwd',
  'find',
  'head',
  'tail',
  'wc',
  // Node.js
  'node',
  'npm',
  'npx',
  'tsx',
  // Build tools
  'tsc',
  'esbuild',
  'vite',
  // Git
  'git',
  // Docker (read-only by default)
  'docker',
  'docker-compose',
  // Testing
  'jest',
  'vitest',
  'mocha',
  // Misc safe commands
  'echo',
  'test',
  'mkdir',
  'cp',
  'mv',
  'touch',
  // Curl for API testing
  'curl',
];

/**
 * Explicitly blocked patterns (even if command is in allowlist).
 * These represent dangerous command patterns that should never be allowed.
 */
const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|--recursive).*\//, // rm -rf with path
  />\s*\/etc\//, // redirect to /etc
  /chmod\s+777/, // overly permissive chmod
  /curl.*\|\s*(ba)?sh/, // curl pipe to shell
];

/**
 * Validation result for commands and paths.
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Path validation result with resolved path.
 */
export interface PathValidationResult extends ValidationResult {
  resolved: string;
}

/**
 * Validate a shell command against the allowlist and blocked patterns.
 *
 * @param command - The command string to validate
 * @returns Validation result with reason if invalid
 */
export function validateCommand(command: string): ValidationResult {
  const trimmed = command.trim();
  const program = trimmed.split(/\s+/)[0];

  // Check allowlist
  if (!ALLOWED_COMMANDS.includes(program)) {
    return { valid: false, reason: `Command '${program}' not in allowlist` };
  }

  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Command matches blocked pattern` };
    }
  }

  return { valid: true };
}

/**
 * Workspace root for path validation.
 * Defaults to /workspace but can be overridden via WORK_DIR env var.
 */
const WORKSPACE_ROOT = process.env.WORK_DIR || '/workspace';

/**
 * Sensitive path patterns that should be blocked even within workspace.
 */
const SENSITIVE_PATTERNS = ['.env', '.git/config', 'credentials', 'secrets'];

/**
 * Validate a file path to ensure it's within the workspace and not sensitive.
 *
 * @param requestedPath - The path to validate (can be relative or absolute)
 * @returns Validation result with resolved absolute path
 */
export function validatePath(requestedPath: string): PathValidationResult {
  const resolved = path.resolve(requestedPath);

  // Must be within workspace
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    return {
      valid: false,
      resolved,
      reason: `Path '${resolved}' is outside workspace '${WORKSPACE_ROOT}'`,
    };
  }

  // Block sensitive paths even within workspace
  const relativePath = resolved.slice(WORKSPACE_ROOT.length);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (relativePath.includes(pattern)) {
      return {
        valid: false,
        resolved,
        reason: `Path contains sensitive pattern: ${pattern}`,
      };
    }
  }

  return { valid: true, resolved };
}

/**
 * Get the current workspace root path.
 */
export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

/**
 * Allowed Docker Compose services that can be restarted.
 *
 * This allowlist provides defense-in-depth alongside HITL approval.
 * Only services in this list can be restarted by the agent.
 */
export const ALLOWED_SERVICES = [
  'store-api',
  'warehouse-alpha',
  'warehouse-beta',
  'bookstore-ui',
] as const;

export type AllowedService = (typeof ALLOWED_SERVICES)[number];

/**
 * Docker Compose file path.
 * Defaults to docker-compose.yaml in workspace root but can be overridden
 * via COMPOSE_FILE env var (matching WORK_DIR pattern).
 */
export function getComposeFilePath(): string {
  return process.env.COMPOSE_FILE || `${WORKSPACE_ROOT}/docker-compose.yaml`;
}

/**
 * Docker Compose project name.
 * When running from inside a container, we need to specify the project name
 * explicitly since Docker Compose derives it from the directory name.
 * Defaults to 'agentops' but can be overridden via COMPOSE_PROJECT_NAME env var.
 */
export function getComposeProjectName(): string {
  return process.env.COMPOSE_PROJECT_NAME || 'agentops';
}

/**
 * Dangerous patterns in service names (defense-in-depth).
 * Even though Zod enum validates, we check for injection characters.
 */
const SERVICE_INJECTION_PATTERNS = [
  /[;&|`$(){}[\]<>\\]/, // Shell metacharacters
  /\s/, // Whitespace (could indicate multiple arguments)
  /\.\./, // Path traversal
  /^-/, // Flag injection
];

/**
 * Validate a service name for docker compose restart.
 *
 * Defense-in-depth validation that checks:
 * 1. Service is in ALLOWED_SERVICES list
 * 2. Service name doesn't contain command injection characters
 *
 * @param serviceName - The service name to validate
 * @returns Validation result with reason if invalid
 */
export function validateServiceRestart(serviceName: string): ValidationResult {
  // Check for injection patterns first (defense-in-depth)
  // This runs even though Zod enum should have validated the service name,
  // because we want to catch any edge cases or bypass attempts
  for (const pattern of SERVICE_INJECTION_PATTERNS) {
    if (pattern.test(serviceName)) {
      return {
        valid: false,
        reason: `Service name contains dangerous characters`,
      };
    }
  }

  // Check allowlist
  if (!ALLOWED_SERVICES.includes(serviceName as AllowedService)) {
    return {
      valid: false,
      reason: `Service '${serviceName}' not in allowlist. Allowed: ${ALLOWED_SERVICES.join(', ')}`,
    };
  }

  return { valid: true };
}
