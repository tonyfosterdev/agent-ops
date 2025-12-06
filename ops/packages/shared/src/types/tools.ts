/**
 * Tool-related types and interfaces
 */

/**
 * Result from shell command execution
 */
export interface ToolResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  error?: string;
}

/**
 * Command validation result
 */
export interface CommandValidation {
  valid: boolean;
  reason?: string;
}

/**
 * File operation result
 */
export interface FileOperationResult {
  success: boolean;
  message: string;
  path: string;
}
