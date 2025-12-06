import { spawn } from 'child_process';
import { z } from 'zod';
import { tool } from 'ai';
import type { ToolResult } from 'ops-shared/types';
import { validateCommand } from '../utils/allowlist';

/**
 * Schema for shell command execution tool
 */
export const shellCommandSchema = z.object({
  command: z.string().describe('The shell command to execute (must be in allowlist)'),
});

/**
 * Executes a shell command with allowlist validation
 *
 * @param command - The command to execute
 * @param workDir - Working directory for command execution
 * @returns Promise<ToolResult> with command output and exit code
 */
export async function executeShellCommand(
  command: string,
  workDir: string
): Promise<ToolResult> {
  // Validate command against allowlist
  const validation = validateCommand(command);

  if (!validation.valid) {
    return {
      command,
      stdout: '',
      stderr: validation.reason || 'Command not allowed',
      exitCode: -1,
      success: false,
      error: validation.reason,
    };
  }

  // Parse command into program and arguments
  const parts = command.trim().split(/\s+/);
  const program = parts[0];
  const args = parts.slice(1);

  return new Promise<ToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';

    // Spawn process without shell evaluation for security
    const proc = spawn(program, args, {
      cwd: workDir,
      shell: false, // Critical: no shell evaluation
      timeout: 30000, // 30 second timeout
    });

    // Capture stdout
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Capture stderr
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Handle process completion
    proc.on('close', (code) => {
      resolve({
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? -1,
        success: code === 0,
      });
    });

    // Handle process errors (e.g., command not found)
    proc.on('error', (err) => {
      resolve({
        command,
        stdout: '',
        stderr: err.message,
        exitCode: -1,
        success: false,
        error: err.message,
      });
    });
  });
}

/**
 * Create the shell command execution tool for Vercel AI SDK
 */
export function createShellTool(workDir: string) {
  return tool({
    description:
      'Execute a shell command. Only allowed commands can be run (cat, node, tsx, npm, echo, ls, pwd, mkdir, test). Use this to run files, read files, and inspect the system.',
    parameters: shellCommandSchema,
    execute: async ({ command }) => {
      const result = await executeShellCommand(command, workDir);

      // Format result for agent observation
      return {
        command: result.command,
        output: result.stdout || result.stderr,
        exitCode: result.exitCode,
        success: result.success,
        error: result.error,
      };
    },
  });
}
