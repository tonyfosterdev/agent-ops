import type { CommandValidation } from 'ops-shared/types';

/**
 * Commands that are allowed with exact matching (no arguments)
 */
const EXACT_COMMANDS = ['pwd', 'ls'];

/**
 * Commands that are allowed with prefix matching (can have arguments)
 * Agent can use these with any arguments
 */
const PREFIX_COMMANDS = ['cat', 'node', 'tsx', 'npm', 'mkdir', 'test', 'echo'];

/**
 * Patterns that trigger immediate rejection
 * These are dangerous operations or shell features we want to block
 */
const BLOCKED_PATTERNS = [
  'rm ',
  'rm\t',
  'sudo',
  'kill',
  'shutdown',
  'reboot',
  'chown',
  'chmod 777',
  '>',
  '>>',
  '|',
  '&',
  ';',
  '`',
  '$(',
  'wget',
  'curl',
  'nc ',
];

/**
 * Validates whether a command is allowed to be executed
 *
 * @param command - The full command string to validate
 * @returns CommandValidation object with valid flag and optional reason
 */
export function validateCommand(command: string): CommandValidation {
  const trimmedCommand = command.trim();

  // Empty commands are not allowed
  if (!trimmedCommand) {
    return {
      valid: false,
      reason: 'Empty command not allowed',
    };
  }

  // Check for blocked patterns first (security)
  for (const pattern of BLOCKED_PATTERNS) {
    if (trimmedCommand.includes(pattern)) {
      return {
        valid: false,
        reason: `Blocked pattern detected: "${pattern}"`,
      };
    }
  }

  // Check for exact match commands
  if (EXACT_COMMANDS.includes(trimmedCommand)) {
    return { valid: true };
  }

  // Check for prefix match commands
  for (const prefix of PREFIX_COMMANDS) {
    if (
      trimmedCommand === prefix ||
      trimmedCommand.startsWith(prefix + ' ') ||
      trimmedCommand.startsWith(prefix + '\t')
    ) {
      return { valid: true };
    }
  }

  // Command not in allowlist
  return {
    valid: false,
    reason: `Command not in allowlist. Allowed commands: ${[...EXACT_COMMANDS, ...PREFIX_COMMANDS].join(', ')}`,
  };
}

/**
 * Get list of all allowed commands for display/documentation
 */
export function getAllowedCommands(): string[] {
  return [...EXACT_COMMANDS, ...PREFIX_COMMANDS];
}
