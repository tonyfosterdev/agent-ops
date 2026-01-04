/**
 * File writing tools for AgentKit.
 *
 * These are dangerous tools that require human approval (HITL)
 * before execution since they modify files on the filesystem.
 * Uses Inngest's step.waitForEvent() to pause for approval.
 *
 * Defense-in-Depth:
 *
 * Paths are validated BEFORE being sent for HITL approval:
 * - Must be within the configured workspace root (WORK_DIR env var)
 * - Cannot contain sensitive patterns (.env, credentials, secrets, etc.)
 * This prevents obviously dangerous operations from reaching the approval queue.
 */
import { createTool } from '@inngest/agent-kit';
import { z } from 'zod';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { validatePath } from './security.js';

/**
 * Write content to a file.
 *
 * This tool is considered dangerous because it modifies files on the
 * filesystem. It uses step.waitForEvent() to wait for human approval
 * before executing, and step.run() for durable execution.
 */
export const writeFileTool = createTool({
  name: 'write_file',
  description:
    'Write content to a file. This is a dangerous operation that requires human approval. The file will be created if it does not exist, or overwritten if it does. Provide a clear reason why this file needs to be written.',
  parameters: z.object({
    path: z.string().describe('Absolute path to the file to write'),
    content: z.string().describe('Content to write to the file'),
    reason: z
      .string()
      .describe('Clear explanation of why this file needs to be written'),
    createDirectories: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to create parent directories if they do not exist (default: false)'),
  }),
  handler: async (
    { path: filePath, content, reason, createDirectories },
    { step, network }
  ) => {
    // Validate path BEFORE waiting for approval
    // This provides defense-in-depth by rejecting writes outside workspace or to sensitive files
    const pathValidation = validatePath(filePath);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: 'Path validation failed',
        reason: pathValidation.reason,
        path: filePath,
        toolCallId: 'validation-failed',
      };
    }

    // Use the validated resolved path
    const absolutePath = pathValidation.resolved;

    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return {
        error: 'Step context not available - tool must be run within Inngest function',
        path: absolutePath,
        toolCallId: 'unavailable',
      };
    }

    // Generate toolCallId in a durable step FIRST so it's recorded and visible
    // in the Inngest UI before we wait for approval. This allows the frontend
    // to discover pending approvals by inspecting step output.
    const toolCallId = await step.run('generate-tool-call-id', () => crypto.randomUUID());

    // Wait for human approval (4 hour timeout)
    // Using dynamic step ID to avoid collisions if tool is called multiple times
    const approval = await step.waitForEvent(`wait-for-write-approval-${toolCallId}`, {
      event: 'agentops/tool.approval',
      match: 'data.toolCallId',
      timeout: '4h',
    }).catch((err: Error) => {
      // Handle timeout gracefully - treat as rejection
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
      }
      throw err;
    });

    // Check if approval was received and granted
    if (!approval || !approval.data.approved) {
      return {
        status: 'rejected',
        error: 'File write rejected by human',
        feedback: approval?.data?.feedback,
        path: absolutePath,
        reason,
        toolCallId,
      };
    }

    // Execute the write operation with durability via step.run()
    // Using dynamic step ID to avoid collisions
    return step.run(`write-file-${toolCallId}`, async () => {
      try {
        // Check if file exists for reporting
        let fileExisted = false;
        try {
          await fs.stat(absolutePath);
          fileExisted = true;
        } catch {
          // File doesn't exist, which is fine
        }

        // Create parent directories if requested
        if (createDirectories) {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        }

        // Check if parent directory exists
        const parentDir = path.dirname(absolutePath);
        try {
          await fs.access(parentDir);
        } catch {
          return {
            error: 'Parent directory does not exist',
            path: absolutePath,
            parentDir,
            hint: 'Set createDirectories: true to create parent directories automatically',
            toolCallId,
          };
        }

        await fs.writeFile(absolutePath, content, 'utf-8');

        const stats = await fs.stat(absolutePath);

        return {
          success: true,
          path: absolutePath,
          size: stats.size,
          created: !fileExisted,
          toolCallId,
        };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;

        if (error.code === 'EACCES') {
          return {
            error: 'Permission denied',
            path: absolutePath,
            toolCallId,
          };
        }
        if (error.code === 'ENOENT') {
          return {
            error: 'Parent directory does not exist',
            path: absolutePath,
            hint: 'Set createDirectories: true to create parent directories automatically',
            toolCallId,
          };
        }

        return {
          error: `Failed to write file: ${error.message}`,
          path: absolutePath,
          toolCallId,
        };
      }
    });
  },
});

/**
 * Append content to a file.
 *
 * Similar to write_file but appends to existing content rather than
 * overwriting. Useful for log files or adding entries to configuration.
 * Uses step.waitForEvent() for HITL approval and step.run() for durability.
 */
export const appendFileTool = createTool({
  name: 'append_file',
  description:
    'Append content to a file. This is a dangerous operation that requires human approval. The file will be created if it does not exist. Provide a clear reason why content needs to be appended.',
  parameters: z.object({
    path: z.string().describe('Absolute path to the file to append to'),
    content: z.string().describe('Content to append to the file'),
    reason: z
      .string()
      .describe('Clear explanation of why content needs to be appended'),
    createDirectories: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to create parent directories if they do not exist (default: false)'),
  }),
  handler: async (
    { path: filePath, content, reason, createDirectories },
    { step, network }
  ) => {
    // Validate path BEFORE waiting for approval
    // This provides defense-in-depth by rejecting writes outside workspace or to sensitive files
    const pathValidation = validatePath(filePath);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: 'Path validation failed',
        reason: pathValidation.reason,
        path: filePath,
        toolCallId: 'validation-failed',
      };
    }

    // Use the validated resolved path
    const absolutePath = pathValidation.resolved;

    // Ensure step is available (it should always be in agent-kit context)
    if (!step) {
      return {
        error: 'Step context not available - tool must be run within Inngest function',
        path: absolutePath,
        toolCallId: 'unavailable',
      };
    }

    // Generate toolCallId in a durable step FIRST so it's recorded and visible
    // in the Inngest UI before we wait for approval. This allows the frontend
    // to discover pending approvals by inspecting step output.
    const toolCallId = await step.run('generate-tool-call-id', () => crypto.randomUUID());

    // Wait for human approval (4 hour timeout)
    // Using dynamic step ID to avoid collisions if tool is called multiple times
    const approval = await step.waitForEvent(`wait-for-append-approval-${toolCallId}`, {
      event: 'agentops/tool.approval',
      match: 'data.toolCallId',
      timeout: '4h',
    }).catch((err: Error) => {
      // Handle timeout gracefully - treat as rejection
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
      }
      throw err;
    });

    // Check if approval was received and granted
    if (!approval || !approval.data.approved) {
      return {
        status: 'rejected',
        error: 'File append rejected by human',
        feedback: approval?.data?.feedback,
        path: absolutePath,
        reason,
        toolCallId,
      };
    }

    // Execute the append operation with durability via step.run()
    // Using dynamic step ID to avoid collisions
    return step.run(`append-file-${toolCallId}`, async () => {
      try {
        // Check if file exists for reporting
        let fileExisted = false;
        try {
          await fs.stat(absolutePath);
          fileExisted = true;
        } catch {
          // File doesn't exist, which is fine
        }

        if (createDirectories) {
          await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        }

        await fs.appendFile(absolutePath, content, 'utf-8');

        const stats = await fs.stat(absolutePath);

        return {
          success: true,
          path: absolutePath,
          size: stats.size,
          created: !fileExisted,
          toolCallId,
        };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;

        return {
          error: `Failed to append to file: ${error.message}`,
          path: absolutePath,
          toolCallId,
        };
      }
    });
  },
});

/**
 * Metadata for dangerous tools, used by the agent layer
 * to determine which tools require HITL approval.
 */
export const writeToolMetadata = {
  write_file: {
    requiresApproval: true,
    riskLevel: 'medium' as const,
    description: 'Writes or overwrites file contents',
  },
  append_file: {
    requiresApproval: true,
    riskLevel: 'medium' as const,
    description: 'Appends content to files',
  },
};

/**
 * All write tools as an array for convenient registration.
 */
export const writeTools = [writeFileTool, appendFileTool];
