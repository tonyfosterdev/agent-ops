/**
 * File writing tools for AgentKit.
 *
 * These are dangerous tools that require human approval (HITL)
 * before execution since they modify files on the filesystem.
 * Uses Inngest's step.waitForEvent() to pause for approval.
 *
 * ## Factory Pattern
 *
 * Tools are created via factory functions that receive a publish function.
 * This allows tools to emit hitl.requested events before waiting for approval.
 *
 * ```typescript
 * const writeTool = createWriteFileTool({ publish });
 * ```
 *
 * ## Defense-in-Depth
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
import type { FactoryContext } from './types.js';
import { createHitlRequestedEvent, createHitlResolvedEvent } from './types.js';

/**
 * Create a write file tool.
 *
 * This tool is considered dangerous because it modifies files on the
 * filesystem. It uses step.waitForEvent() to wait for human approval
 * before executing, and step.run() for durable execution.
 *
 * @param context - Factory context with publish function
 * @returns Configured write file tool
 */
export function createWriteFileTool({ publish }: FactoryContext) {
  return createTool({
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

      // Generate a unique toolCallId for this tool invocation DURABLY
      // This MUST be inside step.run() to ensure the same ID is used if the function
      // restarts between generating the ID and completing waitForEvent.
      // Use unique step ID based on input hash to avoid collisions when tool is called multiple times
      const inputHash = crypto
        .createHash('md5')
        .update(JSON.stringify({ path: absolutePath, contentLength: content.length }))
        .digest('hex')
        .slice(0, 8);
      const toolCallId = await step.run(`generate-write-file-id-${inputHash}`, () =>
        crypto.randomUUID()
      );

      // Get runId from network state for HITL event correlation
      const runId = (network?.state?.kv?.get('runId') as string) || 'unknown';

      // Publish HITL request - dashboard will show approval button
      // Wrapped in step.run for durability (won't republish on function restart)
      try {
        await step.run(`publish-hitl-${toolCallId}`, async () => {
          await publish(
            createHitlRequestedEvent({
              requestId: toolCallId,
              runId,
              toolCalls: [
                {
                  partId: toolCallId,
                  toolName: 'write_file',
                  toolInput: { path: absolutePath, content, reason, createDirectories },
                },
              ],
              expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
              metadata: { reason, riskLevel: 'medium' },
            })
          );
        });
      } catch (publishError) {
        console.error('Failed to publish HITL event:', publishError);
        // Continue - waitForEvent will still work, just no dashboard notification
      }

      // Wait for human approval (4 hour timeout)
      // Using dynamic step ID to avoid collisions if tool is called multiple times
      const approval = await step
        .waitForEvent(`wait-for-write-approval-${toolCallId}`, {
          event: 'agentops/tool.approval',
          if: `async.data.toolCallId == "${toolCallId}"`,
          timeout: '4h',
        })
        .catch((err: Error) => {
          // Handle timeout gracefully - treat as rejection
          if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
            return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
          }
          throw err;
        });

      // Publish resolution event so dashboard knows the request was handled
      try {
        await step.run(`publish-hitl-resolved-${toolCallId}`, async () => {
          await publish(
            createHitlResolvedEvent({
              requestId: toolCallId,
              runId,
              resolution: approval?.data.approved ? 'approved' : 'denied',
              resolvedAt: new Date().toISOString(),
            })
          );
        });
      } catch (publishError) {
        console.error('Failed to publish HITL resolved event:', publishError);
      }

      // Check if approval was received and granted
      if (!approval || !approval.data.approved) {
        const feedback = approval?.data?.feedback;
        return {
          status: 'rejected' as const,
          error: 'File write rejected by human',
          feedback,
          path: absolutePath,
          reason,
          toolCallId,
        };
      }

      // Execute the write operation with durability via step.run()
      const executionResult = await step.run(`write-file-${toolCallId}`, async () => {
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
              success: false,
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
              success: false,
              error: 'Permission denied',
              path: absolutePath,
              toolCallId,
            };
          }
          if (error.code === 'ENOENT') {
            return {
              success: false,
              error: 'Parent directory does not exist',
              path: absolutePath,
              hint: 'Set createDirectories: true to create parent directories automatically',
              toolCallId,
            };
          }

          return {
            success: false,
            error: `Failed to write file: ${error.message}`,
            path: absolutePath,
            toolCallId,
          };
        }
      });

      return executionResult;
    },
  });
}

/**
 * Create an append file tool.
 *
 * Similar to write_file but appends to existing content rather than
 * overwriting. Useful for log files or adding entries to configuration.
 * Uses step.waitForEvent() for HITL approval and step.run() for durability.
 *
 * @param context - Factory context with publish function
 * @returns Configured append file tool
 */
export function createAppendFileTool({ publish }: FactoryContext) {
  return createTool({
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

      const absolutePath = pathValidation.resolved;

      if (!step) {
        return {
          error: 'Step context not available - tool must be run within Inngest function',
          path: absolutePath,
          toolCallId: 'unavailable',
        };
      }

      // Generate unique toolCallId durably
      // Use unique step ID based on input hash to avoid collisions when tool is called multiple times
      const inputHash = crypto
        .createHash('md5')
        .update(JSON.stringify({ path: absolutePath, contentLength: content.length }))
        .digest('hex')
        .slice(0, 8);
      const toolCallId = await step.run(`generate-append-file-id-${inputHash}`, () =>
        crypto.randomUUID()
      );

      // Get runId from network state for HITL event correlation
      const runId = (network?.state?.kv?.get('runId') as string) || 'unknown';

      // Publish HITL request
      try {
        await step.run(`publish-hitl-${toolCallId}`, async () => {
          await publish(
            createHitlRequestedEvent({
              requestId: toolCallId,
              runId,
              toolCalls: [
                {
                  partId: toolCallId,
                  toolName: 'append_file',
                  toolInput: { path: absolutePath, content, reason, createDirectories },
                },
              ],
              expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
              metadata: { reason, riskLevel: 'medium' },
            })
          );
        });
      } catch (publishError) {
        console.error('Failed to publish HITL event:', publishError);
      }

      // Wait for human approval
      const approval = await step
        .waitForEvent(`wait-for-append-approval-${toolCallId}`, {
          event: 'agentops/tool.approval',
          if: `async.data.toolCallId == "${toolCallId}"`,
          timeout: '4h',
        })
        .catch((err: Error) => {
          if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
            return { data: { approved: false, feedback: 'Approval timed out after 4 hours' } };
          }
          throw err;
        });

      // Publish resolution event so dashboard knows the request was handled
      try {
        await step.run(`publish-hitl-resolved-${toolCallId}`, async () => {
          await publish(
            createHitlResolvedEvent({
              requestId: toolCallId,
              runId,
              resolution: approval?.data.approved ? 'approved' : 'denied',
              resolvedAt: new Date().toISOString(),
            })
          );
        });
      } catch (publishError) {
        console.error('Failed to publish HITL resolved event:', publishError);
      }

      if (!approval || !approval.data.approved) {
        const feedback = approval?.data?.feedback;
        return {
          status: 'rejected' as const,
          error: 'File append rejected by human',
          feedback,
          path: absolutePath,
          reason,
          toolCallId,
        };
      }

      // Execute the append operation
      const executionResult = await step.run(`append-file-${toolCallId}`, async () => {
        try {
          let fileExisted = false;
          try {
            await fs.stat(absolutePath);
            fileExisted = true;
          } catch {
            // File doesn't exist
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
            success: false,
            error: `Failed to append to file: ${error.message}`,
            path: absolutePath,
            toolCallId,
          };
        }
      });

      return executionResult;
    },
  });
}

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
 * Create all write tools with publish function injected.
 *
 * @param context - Factory context with publish function
 * @returns Array of write tools
 */
export function createWriteTools(context: FactoryContext) {
  return [createWriteFileTool(context), createAppendFileTool(context)];
}
