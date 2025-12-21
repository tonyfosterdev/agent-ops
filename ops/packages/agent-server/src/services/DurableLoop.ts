/**
 * DurableLoop - The Core State Machine for Event-Sourced Agent Runs
 *
 * This implements the "Durable Run" pattern where:
 * 1. All state is derived from a linear event journal
 * 2. Dangerous tools suspend execution until human approval
 * 3. The loop is fully resumable after server restart
 */

import { generateText, type CoreMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { journalService } from './JournalService';
import { isDangerousTool, type JournalEvent, type ToolProposedPayload, type AgentType } from '../types/journal';
import { logger, config } from '../config';
import { loadAgentDefinition } from '../agents/definitions';
import type { Run } from '../entities/Run';
import type { ToolContext } from '../agents/types';

// Constants for run limits
const MAX_STEPS = 50;

/**
 * Project journal events into LLM messages
 * Reconstructs the conversation with proper tool_use/tool_result pairing
 */
function projectToPrompt(events: Array<{ event_type: string; payload: Record<string, unknown> }>, originalPrompt: string): CoreMessage[] {
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
        const payload = event.payload as { tool_name: string; args: Record<string, unknown>; call_id: string };
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
          content: [{
            type: 'tool-result',
            toolCallId: payload.call_id,
            toolName: proposal?.tool_name || 'unknown',
            result: payload.output_data,
          }] as any,
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
      // Skip CHILD_RUN_STARTED, CHILD_RUN_COMPLETED - these are metadata events for the dashboard.
      // For delegation tools (run_coding_agent, run_log_analyzer_agent), the event sequence is:
      //   1. TOOL_PROPOSED (tool name + args) - recorded by executeSingleStep
      //   2. CHILD_RUN_STARTED - recorded by delegation tool's execute()
      //   3. CHILD_RUN_COMPLETED - recorded by delegation tool's execute()
      //   4. TOOL_RESULT (contains {success, child_run_id, summary}) - recorded by executeSingleStep
      //
      // The LLM conversation only needs TOOL_PROPOSED + TOOL_RESULT pairs.
      // CHILD_RUN_STARTED/COMPLETED are redundant for prompt reconstruction since
      // TOOL_RESULT already contains the delegation outcome from the tool's return value.
      //
      // Skip RUN_STARTED, RUN_SUSPENDED, RUN_COMPLETED, SYSTEM_ERROR - these are
      // run lifecycle events, not conversation content
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
 * Get tools for a run using agent definition, with dangerous tools having their execute function stripped
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

  // For dangerous tools, strip the execute function
  // This allows the AI to propose the tool call, but prevents auto-execution
  const preparedTools: Record<string, any> = {};

  for (const [name, tool] of Object.entries(allTools)) {
    if (isDangerousTool(name)) {
      // Strip execute to prevent auto-execution
      const { execute, ...rest } = tool as any;
      preparedTools[name] = rest;
    } else {
      // Safe tools keep execute for auto-execution
      preparedTools[name] = tool;
    }
  }

  return { allTools, preparedTools };
}

/**
 * Get system prompt for a run using agent definition
 */
function getSystemPromptForRun(run: Run): string {
  const definition = loadAgentDefinition(run.agent_type);
  return definition.getSystemPrompt();
}

/**
 * Execute a single step of the agent run
 */
async function executeSingleStep(runId: string): Promise<{
  done: boolean;
  needsApproval: boolean;
  pendingTool?: ToolProposedPayload;
  error?: string;
}> {
  const run = await journalService.getRun(runId);
  if (!run) {
    return { done: true, needsApproval: false, error: 'Run not found' };
  }

  const events = await journalService.getEvents(runId);
  const messages = projectToPrompt(events, run.prompt);

  const { allTools, preparedTools } = getToolsForRun(run);
  const systemPrompt = getSystemPromptForRun(run);

  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-20250514'),
      maxSteps: 1, // KEY: Single step only for durability
      system: systemPrompt,
      messages,
      tools: preparedTools,
    });

    // Record agent's reasoning
    if (result.text) {
      await journalService.appendEvent(runId, {
        type: 'AGENT_THOUGHT',
        payload: { text_content: result.text },
      });
    }

    // Process tool calls
    const toolCalls = result.toolCalls || [];

    for (const toolCall of toolCalls) {
      if (isDangerousTool(toolCall.toolName)) {
        // Dangerous tool - suspend for approval
        await journalService.appendEvent(runId, {
          type: 'TOOL_PROPOSED',
          payload: {
            tool_name: toolCall.toolName,
            args: toolCall.args as Record<string, unknown>,
            call_id: toolCall.toolCallId,
          },
        });
        await journalService.appendEvent(runId, {
          type: 'RUN_SUSPENDED',
          payload: { reason: `Dangerous tool requires approval: ${toolCall.toolName}` },
        });
        await journalService.updateStatus(runId, 'suspended');

        return {
          done: false,
          needsApproval: true,
          pendingTool: {
            tool_name: toolCall.toolName,
            args: toolCall.args as Record<string, unknown>,
            call_id: toolCall.toolCallId,
          },
        };
      }

      // Safe tool - already executed by SDK, record both proposal and result
      // Record TOOL_PROPOSED first (for conversation reconstruction)
      await journalService.appendEvent(runId, {
        type: 'TOOL_PROPOSED',
        payload: {
          tool_name: toolCall.toolName,
          args: toolCall.args as Record<string, unknown>,
          call_id: toolCall.toolCallId,
        },
      });

      // Then record the result
      const toolResult = result.toolResults?.find((r) => r.toolCallId === toolCall.toolCallId);
      await journalService.appendEvent(runId, {
        type: 'TOOL_RESULT',
        payload: {
          call_id: toolCall.toolCallId,
          output_data: toolResult?.result ?? null,
          status: 'success',
        },
      });
    }

    // Increment step counter
    await journalService.incrementStep(runId);

    // Check if done
    if (result.finishReason === 'stop' || toolCalls.length === 0) {
      return { done: true, needsApproval: false };
    }

    return { done: false, needsApproval: false };
  } catch (error: any) {
    logger.error({ runId, error: error.message }, 'Step execution failed');
    await journalService.appendEvent(runId, {
      type: 'SYSTEM_ERROR',
      payload: { error_details: error.message },
    });
    return { done: true, needsApproval: false, error: error.message };
  }
}

/**
 * Main durable loop - runs until completion, suspension, or error
 */
export async function runAgentStep(runId: string): Promise<void> {
  const run = await journalService.getRun(runId);
  if (!run) {
    logger.error({ runId }, 'Run not found');
    return;
  }

  // Check terminal states
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    logger.info({ runId, status: run.status }, 'Run already in terminal state');
    return;
  }

  // Check suspended state
  if (run.status === 'suspended') {
    logger.info({ runId }, 'Run is suspended, waiting for approval');
    return;
  }

  // Check step limit to prevent runaway loops
  if (run.current_step >= MAX_STEPS) {
    logger.error({ runId, currentStep: run.current_step, maxSteps: MAX_STEPS }, 'Run exceeded maximum step limit');
    await journalService.appendEvent(runId, {
      type: 'SYSTEM_ERROR',
      payload: { error_details: `Run exceeded maximum step limit (${MAX_STEPS})` },
    });
    await journalService.updateStatus(runId, 'failed');
    return;
  }

  // Transition to running if pending
  if (run.status === 'pending') {
    await journalService.appendEvent(runId, {
      type: 'RUN_STARTED',
      payload: { prompt: run.prompt, user_id: run.user_id },
    });
    await journalService.updateStatus(runId, 'running');
  }

  // Execute steps until done, suspended, or error
  while (true) {
    const result = await executeSingleStep(runId);

    if (result.error) {
      await journalService.updateStatus(runId, 'failed');
      return;
    }

    if (result.needsApproval) {
      // Already marked as suspended in executeSingleStep
      return;
    }

    if (result.done) {
      const events = await journalService.getEvents(runId);
      const lastThought = events
        .filter((e) => e.event_type === 'AGENT_THOUGHT')
        .pop();
      const summary = lastThought
        ? (lastThought.payload as { text_content: string }).text_content
        : 'Task completed';

      await journalService.appendEvent(runId, {
        type: 'RUN_COMPLETED',
        payload: { summary },
      });
      await journalService.updateStatus(runId, 'completed');
      return;
    }

    // Continue to next step
  }
}

/**
 * Resume a suspended run after approval or rejection
 */
export async function resumeRun(
  runId: string,
  decision: 'approved' | 'rejected',
  feedback?: string
): Promise<void> {
  const run = await journalService.getRun(runId);
  if (!run) {
    throw new Error('Run not found');
  }

  if (run.status !== 'suspended') {
    throw new Error(`Cannot resume run with status: ${run.status}`);
  }

  // Record the decision
  await journalService.appendEvent(runId, {
    type: 'RUN_RESUMED',
    payload: { decision, feedback },
  });

  if (decision === 'approved') {
    // Execute the pending tool
    const events = await journalService.getEvents(runId);
    const pendingTool = journalService.findPendingTool(events);

    if (pendingTool) {
      const { allTools } = getToolsForRun(run);
      const tool = allTools[pendingTool.tool_name as keyof typeof allTools];

      if (tool && 'execute' in tool) {
        try {
          const result = await (tool as any).execute(pendingTool.args);

          await journalService.appendEvent(runId, {
            type: 'TOOL_RESULT',
            payload: {
              call_id: pendingTool.call_id,
              output_data: result,
              status: 'success',
            },
          });
        } catch (error: any) {
          await journalService.appendEvent(runId, {
            type: 'TOOL_RESULT',
            payload: {
              call_id: pendingTool.call_id,
              output_data: { error: error.message },
              status: 'error',
            },
          });
        }
      }
    }
  }

  // Update status and continue
  await journalService.updateStatus(runId, 'running');
  await runAgentStep(runId);
}

/**
 * Start a new run
 */
export async function startRun(prompt: string, userId: string, agentType: AgentType = 'orchestrator'): Promise<string> {
  const runId = await journalService.createRun(prompt, userId, agentType);

  // Start execution in background (non-blocking)
  runAgentStep(runId).catch((error) => {
    logger.error({ runId, error: error.message }, 'Run failed');
  });

  return runId;
}
