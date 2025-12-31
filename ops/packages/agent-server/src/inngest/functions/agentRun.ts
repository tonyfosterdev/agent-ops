/**
 * Agent Run Function - Durable Execution with HITL Support
 *
 * This Inngest function implements the core agent execution loop with:
 * - Durable checkpoints via step.run() for crash recovery
 * - Human-in-the-loop (HITL) via step.waitForEvent() for dangerous tools
 * - Cancellation support via cancelOn configuration
 *
 * The function replaces the while(true) loop in DurableLoop.ts with
 * Inngest's step-based execution model, gaining automatic retry,
 * persistence, and observability.
 *
 * @see MIGRATION_PLAN.md Part 2.3 for architecture details
 */

import { generateText, type CoreMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { inngest } from '../client';
import { journalService } from '../../services/JournalService';
import { loadAgentDefinition } from '../../agents/definitions';
import { isDangerousTool } from '../../types/journal';
import { logger, config } from '../../config';
import type { Run } from '../../entities/Run';
import type { ToolContext } from '../../agents/types';
import type { JournalEntry } from '../../entities/JournalEntry';

// Maximum steps per run to prevent runaway execution
const MAX_STEPS = 50;

// HITL approval timeout (72 hours as per plan)
const HITL_TIMEOUT = '72h';

/**
 * Result type for each execution step
 *
 * Using a discriminated union with explicit flags to help TypeScript
 * narrow the type correctly after step.run() returns.
 */
interface StepResult {
  done: boolean;
  error?: string;
  cancelled?: boolean;
  needsApproval?: boolean;
  pendingTool?: {
    toolName: string;
    args: Record<string, unknown>;
    callId: string;
  };
}

/**
 * Project journal events into LLM messages
 *
 * Reconstructs the conversation history from event journal entries,
 * properly pairing tool_use and tool_result for Claude's API format.
 */
function projectToPrompt(
  events: Array<{ event_type: string; payload: Record<string, unknown> }>,
  originalPrompt: string
): CoreMessage[] {
  const messages: CoreMessage[] = [];

  // Start with the original user prompt
  messages.push({ role: 'user', content: originalPrompt });

  // Track tool proposals to pair with results
  const toolProposals = new Map<string, { tool_name: string; args: Record<string, unknown> }>();

  // Buffer for combining assistant thought + tool calls into single message
  let pendingThought: string | null = null;
  let pendingToolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }> = [];

  for (const event of events) {
    switch (event.event_type) {
      case 'AGENT_THOUGHT': {
        // Flush any pending assistant message first
        if (pendingThought || pendingToolCalls.length > 0) {
          flushAssistantMessage(messages, pendingThought, pendingToolCalls);
          pendingThought = null;
          pendingToolCalls = [];
        }

        const payload = event.payload as { text_content: string };
        pendingThought = payload.text_content;
        break;
      }
      case 'TOOL_PROPOSED': {
        const payload = event.payload as {
          tool_name: string;
          args: Record<string, unknown>;
          call_id: string;
        };
        toolProposals.set(payload.call_id, { tool_name: payload.tool_name, args: payload.args });

        // Add to pending tool calls (will be flushed as assistant message)
        pendingToolCalls.push({
          toolCallId: payload.call_id,
          toolName: payload.tool_name,
          args: payload.args,
        });
        break;
      }
      case 'TOOL_RESULT': {
        // Flush pending assistant message before adding tool result
        if (pendingThought || pendingToolCalls.length > 0) {
          flushAssistantMessage(messages, pendingThought, pendingToolCalls);
          pendingThought = null;
          pendingToolCalls = [];
        }

        const payload = event.payload as { call_id: string; output_data: unknown; status: string };
        const proposal = toolProposals.get(payload.call_id);

        messages.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: payload.call_id,
              toolName: proposal?.tool_name || 'unknown',
              result: payload.output_data,
            },
          ] as any,
        });
        break;
      }
      case 'RUN_RESUMED': {
        // Flush pending assistant message
        if (pendingThought || pendingToolCalls.length > 0) {
          flushAssistantMessage(messages, pendingThought, pendingToolCalls);
          pendingThought = null;
          pendingToolCalls = [];
        }

        const payload = event.payload as { decision: string; feedback?: string };
        if (payload.decision === 'rejected' && payload.feedback) {
          messages.push({ role: 'user', content: `Tool execution was rejected: ${payload.feedback}` });
        }
        break;
      }
      // Skip lifecycle events (RUN_STARTED, RUN_SUSPENDED, etc.) as they don't
      // contribute to the LLM conversation
    }
  }

  // Flush any remaining pending message
  if (pendingThought || pendingToolCalls.length > 0) {
    flushAssistantMessage(messages, pendingThought, pendingToolCalls);
  }

  return messages;
}

/**
 * Helper to create assistant message with optional text and tool calls
 */
function flushAssistantMessage(
  messages: CoreMessage[],
  thought: string | null,
  toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>
): void {
  if (!thought && toolCalls.length === 0) return;

  const content: any[] = [];

  if (thought) {
    content.push({ type: 'text', text: thought });
  }

  for (const tc of toolCalls) {
    content.push({
      type: 'tool-call',
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      args: tc.args,
    });
  }

  messages.push({ role: 'assistant', content });
}

/**
 * Get tools for a run using agent definition
 *
 * Strips execute from ALL tools to give us full control over event ordering.
 * Returns a Map of raw execute functions for manual execution.
 */
function getToolsForRun(run: Run) {
  const definition = loadAgentDefinition(run.agent_type);

  const context: ToolContext = {
    workDir: config.workDir,
    lokiUrl: config.lokiUrl,
    runId: run.id,
    parentRunId: run.parent_run_id,
  };

  const allTools = definition.getTools(context);

  // Store raw execute functions for manual execution
  const executeFunctions = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  // Strip execute from ALL tools for LLM - this prevents SDK auto-execution
  // and gives us full control over event ordering (TOOL_PROPOSED before execution)
  const preparedTools: Record<string, any> = {};

  for (const [name, tool] of Object.entries(allTools)) {
    const toolAny = tool as any;
    // Save execute function before stripping
    if (typeof toolAny.execute === 'function') {
      executeFunctions.set(name, toolAny.execute);
    }
    // Strip execute from ALL tools
    const { execute, ...rest } = toolAny;
    preparedTools[name] = rest;
  }

  return { preparedTools, executeFunctions };
}

/**
 * Find pending tool from journal entries
 */
function findPendingTool(
  entries: JournalEntry[]
): { tool_name: string; args: Record<string, unknown>; call_id: string } | null {
  const proposedTools = new Map<
    string,
    { tool_name: string; args: Record<string, unknown>; call_id: string }
  >();
  const completedTools = new Set<string>();

  for (const entry of entries) {
    if (entry.event_type === 'TOOL_PROPOSED') {
      const payload = entry.payload as {
        tool_name: string;
        args: Record<string, unknown>;
        call_id: string;
      };
      proposedTools.set(payload.call_id, payload);
    } else if (entry.event_type === 'TOOL_RESULT') {
      const payload = entry.payload as { call_id: string };
      completedTools.add(payload.call_id);
    }
  }

  // Find the first proposed tool that hasn't been completed
  for (const [callId, tool] of proposedTools) {
    if (!completedTools.has(callId)) {
      return tool;
    }
  }

  return null;
}

/**
 * Main agent run function
 *
 * This function orchestrates the entire agent lifecycle:
 * 1. Initializes the run and records RUN_STARTED
 * 2. Executes steps in a durable loop (each step is a checkpoint)
 * 3. Pauses for HITL approval on dangerous tools
 * 4. Completes when the agent finishes or reaches max steps
 *
 * Key Inngest features used:
 * - step.run(): Creates durable checkpoints that survive restarts
 * - step.waitForEvent(): Pauses execution waiting for external events
 * - cancelOn: Allows runs to be cancelled via events
 */
export const agentRunFunction = inngest.createFunction(
  {
    id: 'agent-run',
    retries: 0, // We handle errors at step level for better control
    cancelOn: [
      {
        event: 'agent/run.cancelled',
        match: 'data.runId',
      },
    ],
  },
  { event: 'agent/run.started' },
  async ({ event, step }) => {
    const { runId, prompt, userId, agentType, parentRunId } = event.data;

    logger.info({ runId, agentType }, 'Inngest: Starting agent run');

    // Step 1: Initialize the run
    // Uses idempotent write to safely handle Inngest step retries
    await step.run('init', async () => {
      const run = await journalService.getRun(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      // Only record RUN_STARTED if not already started (handles retries)
      if (run.status === 'pending') {
        await journalService.appendEventIdempotent(
          runId,
          {
            type: 'RUN_STARTED',
            payload: { prompt, user_id: userId },
          },
          'init-run-started'
        );
        await journalService.updateStatus(runId, 'running');
      }
    });

    // Step 2: Execute agent steps in a loop
    let stepCount = 0;
    let isComplete = false;

    while (!isComplete && stepCount < MAX_STEPS) {
      const stepName = `execute-step-${stepCount}`;

      // Each LLM call is a durable step
      // Using explicit type assertion since step.run infers a partial type
      // All journal writes use idempotent keys based on stepName and event context
      const stepResult = await step.run(stepName, async (): Promise<StepResult> => {
        const run = await journalService.getRun(runId);
        if (!run) {
          return { done: true, error: 'Run not found' };
        }

        // Check if run was cancelled
        if (run.status === 'cancelled') {
          return { done: true, cancelled: true };
        }

        const events = await journalService.getEvents(runId);
        const messages = projectToPrompt(events, run.prompt);

        const { preparedTools, executeFunctions } = getToolsForRun(run);
        const definition = loadAgentDefinition(run.agent_type);
        const systemPrompt = definition.getSystemPrompt();

        try {
          const result = await generateText({
            model: anthropic('claude-sonnet-4-20250514'),
            maxSteps: 1, // Single step for durability
            system: systemPrompt,
            messages,
            tools: preparedTools,
          });

          // Record agent's reasoning with idempotent key
          if (result.text) {
            await journalService.appendEventIdempotent(
              runId,
              {
                type: 'AGENT_THOUGHT',
                payload: { text_content: result.text },
              },
              `${stepName}-thought`
            );
          }

          // Process tool calls
          const toolCalls = result.toolCalls || [];
          const pendingDangerousTools: Array<{
            toolName: string;
            args: Record<string, unknown>;
            callId: string;
          }> = [];

          for (const toolCall of toolCalls) {
            // Record TOOL_PROPOSED with idempotent key using tool call ID
            await journalService.appendEventIdempotent(
              runId,
              {
                type: 'TOOL_PROPOSED',
                payload: {
                  tool_name: toolCall.toolName,
                  args: toolCall.args as Record<string, unknown>,
                  call_id: toolCall.toolCallId,
                },
              },
              `${stepName}-proposed-${toolCall.toolCallId}`
            );

            if (isDangerousTool(toolCall.toolName)) {
              // Queue dangerous tool for HITL
              pendingDangerousTools.push({
                toolName: toolCall.toolName,
                args: toolCall.args as Record<string, unknown>,
                callId: toolCall.toolCallId,
              });
            } else {
              // Execute safe tool immediately
              const executeFunc = executeFunctions.get(toolCall.toolName);
              if (executeFunc) {
                try {
                  const toolResult = await executeFunc(toolCall.args as Record<string, unknown>);
                  await journalService.appendEventIdempotent(
                    runId,
                    {
                      type: 'TOOL_RESULT',
                      payload: {
                        call_id: toolCall.toolCallId,
                        output_data: toolResult,
                        status: 'success',
                      },
                    },
                    `${stepName}-result-${toolCall.toolCallId}`
                  );
                } catch (error: any) {
                  await journalService.appendEventIdempotent(
                    runId,
                    {
                      type: 'TOOL_RESULT',
                      payload: {
                        call_id: toolCall.toolCallId,
                        output_data: { error: error.message },
                        status: 'error',
                      },
                    },
                    `${stepName}-result-${toolCall.toolCallId}`
                  );
                }
              } else {
                logger.warn({ runId, toolName: toolCall.toolName }, 'No execute function found');
                await journalService.appendEventIdempotent(
                  runId,
                  {
                    type: 'TOOL_RESULT',
                    payload: {
                      call_id: toolCall.toolCallId,
                      output_data: { error: `No execute function for: ${toolCall.toolName}` },
                      status: 'error',
                    },
                  },
                  `${stepName}-result-${toolCall.toolCallId}`
                );
              }
            }
          }

          // Increment step counter
          await journalService.incrementStep(runId);

          // Check completion conditions
          if (result.finishReason === 'stop' || toolCalls.length === 0) {
            return { done: true };
          }

          // If there are dangerous tools pending, signal for HITL
          if (pendingDangerousTools.length > 0) {
            const firstDangerous = pendingDangerousTools[0];

            // When multiple dangerous tools are proposed in a single LLM response,
            // only the first will be queued for approval. Others are recorded as
            // skipped with an explanation, so the LLM can re-propose them if needed.
            if (pendingDangerousTools.length > 1) {
              logger.warn(
                { runId, count: pendingDangerousTools.length },
                'Multiple dangerous tools proposed - only first will be queued for approval, others will be skipped'
              );

              // Record skipped tools as TOOL_RESULT with status='skipped'
              for (let i = 1; i < pendingDangerousTools.length; i++) {
                const skippedTool = pendingDangerousTools[i];
                await journalService.appendEventIdempotent(
                  runId,
                  {
                    type: 'TOOL_RESULT',
                    payload: {
                      call_id: skippedTool.callId,
                      output_data: {
                        error: 'Tool skipped: only one dangerous tool can be approved at a time. Please re-propose this tool after the pending approval is processed.',
                      },
                      status: 'skipped',
                    },
                  },
                  `${stepName}-skipped-${skippedTool.callId}`
                );
              }
            }

            await journalService.appendEventIdempotent(
              runId,
              {
                type: 'RUN_SUSPENDED',
                payload: { reason: `Dangerous tool requires approval: ${firstDangerous.toolName}` },
              },
              `${stepName}-suspended`
            );
            await journalService.updateStatus(runId, 'suspended');
            return {
              done: false,
              needsApproval: true,
              pendingTool: firstDangerous,
            };
          }

          return { done: false };
        } catch (error: any) {
          logger.error({ runId, error: error.message }, 'Step execution failed');
          await journalService.appendEventIdempotent(
            runId,
            {
              type: 'SYSTEM_ERROR',
              payload: { error_details: error.message },
            },
            `${stepName}-error`
          );
          return { done: true, error: error.message };
        }
      });

      // Handle step result
      if (stepResult.done) {
        isComplete = true;

        if (stepResult.error) {
          await step.run('mark-failed', async () => {
            await journalService.updateStatus(runId, 'failed');
          });
        } else if (stepResult.cancelled) {
          // Already marked as cancelled
          logger.info({ runId }, 'Run was cancelled');
        } else {
          // Success - complete the run
          await step.run('complete', async () => {
            const events = await journalService.getEvents(runId);
            const lastThought = events.filter((e) => e.event_type === 'AGENT_THOUGHT').pop();
            const summary = lastThought
              ? (lastThought.payload as { text_content: string }).text_content
              : 'Task completed';

            await journalService.appendEventIdempotent(
              runId,
              {
                type: 'RUN_COMPLETED',
                payload: { summary },
              },
              'complete-run-completed'
            );
            await journalService.updateStatus(runId, 'completed');
          });
        }
        break;
      }

      // Handle HITL suspension
      if (stepResult.needsApproval) {
        logger.info({ runId, tool: stepResult.pendingTool?.toolName }, 'Waiting for HITL approval');

        // Wait for human decision
        const approval = await step.waitForEvent('wait-for-approval', {
          event: 'agent/run.resumed',
          match: 'data.runId',
          timeout: HITL_TIMEOUT,
        });

        if (!approval) {
          // Timeout - mark as failed
          await step.run('timeout-failed', async () => {
            await journalService.appendEventIdempotent(
              runId,
              {
                type: 'SYSTEM_ERROR',
                payload: { error_details: 'HITL approval timeout after 72 hours' },
              },
              'timeout-failed-error'
            );
            await journalService.updateStatus(runId, 'failed');
          });
          break;
        }

        // Process the approval/rejection
        // Uses idempotent writes to handle Inngest step retries safely
        await step.run('process-approval', async () => {
          const { decision, feedback } = approval.data;

          // Record the decision with idempotent key
          await journalService.appendEventIdempotent(
            runId,
            {
              type: 'RUN_RESUMED',
              payload: { decision, feedback },
            },
            'process-approval-resumed'
          );

          if (decision === 'approved') {
            // Execute the pending dangerous tool
            const run = await journalService.getRun(runId);
            if (!run) throw new Error('Run not found');

            const events = await journalService.getEvents(runId);
            const pendingTool = findPendingTool(events);

            if (pendingTool) {
              const { executeFunctions } = getToolsForRun(run);
              const executeFunc = executeFunctions.get(pendingTool.tool_name);

              if (executeFunc) {
                try {
                  const result = await executeFunc(pendingTool.args);
                  await journalService.appendEventIdempotent(
                    runId,
                    {
                      type: 'TOOL_RESULT',
                      payload: {
                        call_id: pendingTool.call_id,
                        output_data: result,
                        status: 'success',
                      },
                    },
                    `process-approval-result-${pendingTool.call_id}`
                  );
                } catch (error: any) {
                  await journalService.appendEventIdempotent(
                    runId,
                    {
                      type: 'TOOL_RESULT',
                      payload: {
                        call_id: pendingTool.call_id,
                        output_data: { error: error.message },
                        status: 'error',
                      },
                    },
                    `process-approval-result-${pendingTool.call_id}`
                  );
                }
              } else {
                await journalService.appendEventIdempotent(
                  runId,
                  {
                    type: 'TOOL_RESULT',
                    payload: {
                      call_id: pendingTool.call_id,
                      output_data: { error: `No execute function for: ${pendingTool.tool_name}` },
                      status: 'error',
                    },
                  },
                  `process-approval-result-${pendingTool.call_id}`
                );
              }
            }
          }

          // Resume execution
          await journalService.updateStatus(runId, 'running');
        });

        // If rejected, the loop will continue and the LLM will see the rejection feedback
      }

      stepCount++;
    }

    // Check if we hit the step limit
    if (stepCount >= MAX_STEPS && !isComplete) {
      await step.run('max-steps-failed', async () => {
        await journalService.appendEventIdempotent(
          runId,
          {
            type: 'SYSTEM_ERROR',
            payload: { error_details: `Run exceeded maximum step limit (${MAX_STEPS})` },
          },
          'max-steps-failed-error'
        );
        await journalService.updateStatus(runId, 'failed');
      });
    }

    logger.info({ runId, stepCount }, 'Inngest: Agent run finished');

    return { runId, stepCount, status: 'finished' };
  }
);
