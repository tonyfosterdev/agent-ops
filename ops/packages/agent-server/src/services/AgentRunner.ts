/**
 * AgentRunner - State Machine Agent Execution
 *
 * Controls agent execution with explicit state machine.
 * All state persisted to DB, fully resumable after server restart.
 */

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { AppDataSource } from '../database.js';
import { AgentRun, type RunStatus } from '../entities/AgentRun.js';
import { JournalService } from './JournalService.js';
import { ContextService } from './ContextService.js';
import { ApprovalService } from './ApprovalService.js';
import { logger } from '../config.js';

// Tool imports from agents
import {
  createShellTool,
  createReadFileTool,
  createWriteFileTool,
  createFindFilesTool,
  createSearchCodeTool,
} from '../agents/coding/tools/index.js';
import { getSystemPrompt as getCodingPrompt } from '../agents/coding/prompts.js';

import {
  createLokiQueryTool,
  createLogAnalysisTool,
  createReportGenerationTool,
} from '../agents/log-analyzer/tools/index.js';
import { getSystemPrompt as getLogAnalyzerPrompt } from '../agents/log-analyzer/prompts.js';
import { getLokiConfig } from 'ops-shared/config';

/**
 * Tools that are safe to execute without human approval (read-only)
 */
const SAFE_TOOLS = new Set([
  'read_file',
  'find_files',
  'search_code',
  'loki_query',
  'analyze_logs',
]);

/**
 * Result from executing a single step
 */
interface StepResult {
  done?: boolean;
  finalMessage?: string;
  needsApproval?: boolean;
  pendingTool?: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  };
  messages?: any[];
  error?: string;
}

export class AgentRunner {
  private runRepository = AppDataSource.getRepository(AgentRun);
  private journalService = new JournalService();
  private contextService: ContextService;
  private approvalService = new ApprovalService();

  constructor() {
    this.contextService = new ContextService(this.journalService);
  }

  /**
   * Start a new run - transitions from pending to running
   */
  async start(runId: string): Promise<void> {
    logger.info({ runId }, 'Starting agent run');
    await this.transitionTo(runId, 'running');
    await this.executeLoop(runId);
  }

  /**
   * Resume a suspended run after approval/rejection
   */
  async resume(runId: string): Promise<void> {
    logger.info({ runId }, 'Resuming agent run');
    await this.executeLoop(runId);
  }

  /**
   * Main state machine loop
   */
  private async executeLoop(runId: string): Promise<void> {
    // Check for mock agent type (used for testing)
    const initialRun = await this.loadRun(runId);
    if (initialRun?.agent_type === 'mock') {
      await this.executeMockAgent(initialRun);
      return;
    }

    while (true) {
      const run = await this.loadRun(runId);
      if (!run) {
        logger.error({ runId }, 'Run not found');
        return;
      }

      logger.debug({ runId, status: run.status }, 'Loop iteration');

      // Terminal states
      if (run.status === 'completed' || run.status === 'failed') {
        return;
      }

      // Suspended - check if approval came in
      if (run.status === 'suspended') {
        const handled = await this.handleSuspendedState(run);
        if (!handled) {
          return; // Still waiting for approval
        }
        continue; // Approval handled, loop again
      }

      // Running - execute a step
      if (run.status === 'running') {
        try {
          const result = await this.executeSingleStep(run);

          if (result.error) {
            await this.fail(runId, result.error);
            return;
          }

          if (result.done) {
            await this.complete(runId, result.finalMessage || 'Task completed', run.current_step + 1);
            return;
          }

          if (result.needsApproval && result.pendingTool) {
            await this.suspend(runId, result.pendingTool, result.messages || []);
            return; // Exit loop, wait for external resume
          }

          // Safe tools executed, continue with updated messages
          if (result.messages) {
            await this.saveMessages(runId, result.messages, run.current_step + 1);
          }
          continue;
        } catch (error: any) {
          logger.error({ runId, error: error.message }, 'Step execution failed');
          await this.fail(runId, error.message);
          return;
        }
      }

      // Unknown state
      logger.error({ runId, status: run.status }, 'Unknown run status');
      await this.fail(runId, `Unknown status: ${run.status}`);
      return;
    }
  }

  /**
   * Handle a suspended run - check approval status
   */
  private async handleSuspendedState(run: AgentRun): Promise<boolean> {
    if (!run.pending_tool) {
      logger.error({ runId: run.id }, 'Suspended run has no pending tool');
      await this.fail(run.id, 'Invalid state: no pending tool');
      return true;
    }

    const approval = await this.approvalService.getByToolCallId(
      run.id,
      run.pending_tool.toolCallId
    );

    if (!approval || approval.status === 'pending') {
      return false; // Still waiting
    }

    if (approval.status === 'approved') {
      // Execute the approved tool
      await this.executeApprovedTool(run);
      await this.transitionTo(run.id, 'running');
      return true;
    }

    if (approval.status === 'rejected') {
      // Inject rejection into messages and continue
      await this.injectRejection(run, approval.rejection_reason || 'Rejected by user');
      await this.transitionTo(run.id, 'running');
      return true;
    }

    if (approval.status === 'timeout') {
      await this.fail(run.id, 'Approval timed out');
      return true;
    }

    return false;
  }

  /**
   * Execute a single step with generateText(maxSteps=1)
   */
  private async executeSingleStep(run: AgentRun): Promise<StepResult> {
    const agentConfig = this.getAgentConfig(run.agent_type, run.config?.workDir);
    if (!agentConfig) {
      return { error: `Unknown agent type: ${run.agent_type}` };
    }

    const { model, systemPrompt, tools } = agentConfig;

    // Build initial messages if none exist
    let messages = run.messages;
    if (!messages || messages.length === 0) {
      // Build context from session
      const context = await this.contextService.buildContext(run.session_id);

      // Start with context summary in system prompt
      let fullSystemPrompt = systemPrompt;
      if (context.summary) {
        fullSystemPrompt += `\n\n## Previous Context\n${context.summary}`;
      }

      // Build messages from recent context + current task
      messages = [];
      for (const msg of context.recentMessages) {
        messages.push({ role: msg.role, content: msg.content });
      }
      messages.push({ role: 'user', content: run.task });
    }

    // Write journal entry for step start
    await this.journalService.writeEntry(run.id, 'step:start', {
      step: run.current_step + 1,
    }, run.current_step + 1);

    const result = await generateText({
      model,
      maxSteps: 1,  // KEY: Single step only
      system: systemPrompt,
      messages,
      tools,
    });

    // Write text output
    if (result.text) {
      await this.journalService.writeEntry(run.id, 'text', {
        text: result.text,
      }, run.current_step + 1);
    }

    // Check tool calls
    const toolCalls = result.toolCalls || [];
    for (const call of toolCalls) {
      if (!SAFE_TOOLS.has(call.toolName)) {
        // Dangerous tool - create approval request and suspend
        await this.createApprovalRequest(run, call);

        // Write pending approval entry
        await this.journalService.writeEntry(run.id, 'tool:pending_approval', {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          args: call.args,
        }, run.current_step + 1);

        return {
          needsApproval: true,
          pendingTool: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            args: call.args as Record<string, unknown>,
          },
          messages: this.extractMessages(result, messages),
        };
      }

      // Safe tool - write journal entries (tool already executed by SDK)
      await this.journalService.writeEntry(run.id, 'tool:starting', {
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        args: call.args,
      }, run.current_step + 1);

      const toolResult = result.toolResults?.find(r => r.toolCallId === call.toolCallId);
      await this.journalService.writeEntry(run.id, 'tool:complete', {
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        result: toolResult?.result,
        success: true,
      }, run.current_step + 1);
    }

    // Write step complete
    await this.journalService.writeEntry(run.id, 'step:complete', {
      step: run.current_step + 1,
    }, run.current_step + 1);

    // Check if done (no more tool calls, model finished naturally)
    if (result.finishReason === 'stop') {
      return { done: true, finalMessage: result.text };
    }

    // Continue looping with updated messages
    return {
      done: false,
      messages: this.extractMessages(result, messages),
    };
  }

  /**
   * Execute mock agent (for testing - doesn't call Claude API)
   */
  private async executeMockAgent(run: AgentRun): Promise<void> {
    try {
      // Write run started
      await this.journalService.writeEntry(run.id, 'run:started', {
        task: run.task,
        maxSteps: run.config?.maxSteps || 10,
        agentType: 'mock',
      });

      const stepNumber = 1;

      // Write a mock step with text and tool
      await this.journalService.writeEntry(run.id, 'text', {
        text: 'Starting mock task execution...',
      }, stepNumber);

      // Write mock tool execution
      const toolCallId = 'mock-call-1';
      await this.journalService.writeEntry(run.id, 'tool:starting', {
        toolName: 'mockTool',
        toolCallId,
        args: { input: 'test' },
      }, stepNumber);

      await this.journalService.writeEntry(run.id, 'tool:complete', {
        toolName: 'mockTool',
        toolCallId,
        result: { output: 'mock result' },
        success: true,
      }, stepNumber);

      await this.journalService.writeEntry(run.id, 'step:complete', {
        step: stepNumber,
      }, stepNumber);

      // Complete the run
      const message = `Mock agent completed 1 step(s) for task: ${run.task}`;
      await this.complete(run.id, message, 1);
    } catch (error: any) {
      await this.fail(run.id, error.message);
    }
  }

  /**
   * Execute a tool that was approved
   */
  private async executeApprovedTool(run: AgentRun): Promise<void> {
    if (!run.pending_tool) return;

    const agentConfig = this.getAgentConfig(run.agent_type, run.config?.workDir);
    if (!agentConfig) return;

    const tool = agentConfig.tools[run.pending_tool.toolName];
    if (!tool || !tool.execute) {
      logger.error({ toolName: run.pending_tool.toolName }, 'Tool not found');
      return;
    }

    // Write approval entry
    await this.journalService.writeEntry(run.id, 'tool:approved', {
      toolName: run.pending_tool.toolName,
      toolCallId: run.pending_tool.toolCallId,
    }, run.current_step);

    // Write starting entry
    await this.journalService.writeEntry(run.id, 'tool:starting', {
      toolName: run.pending_tool.toolName,
      toolCallId: run.pending_tool.toolCallId,
      args: run.pending_tool.args,
    }, run.current_step);

    try {
      // Execute the tool
      const result = await tool.execute(run.pending_tool.args, {
        toolCallId: run.pending_tool.toolCallId,
      });

      // Write complete entry
      await this.journalService.writeEntry(run.id, 'tool:complete', {
        toolName: run.pending_tool.toolName,
        toolCallId: run.pending_tool.toolCallId,
        result,
        success: true,
      }, run.current_step);

      // Add tool result to messages
      const messages = run.messages || [];
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: run.pending_tool.toolCallId,
          result,
        }],
      });

      await this.saveMessages(run.id, messages, run.current_step);
      await this.clearPendingTool(run.id);
    } catch (error: any) {
      await this.journalService.writeEntry(run.id, 'tool:complete', {
        toolName: run.pending_tool.toolName,
        toolCallId: run.pending_tool.toolCallId,
        result: { error: error.message },
        success: false,
      }, run.current_step);
    }
  }

  /**
   * Inject a rejection result into messages
   */
  private async injectRejection(run: AgentRun, reason: string): Promise<void> {
    if (!run.pending_tool) return;

    // Write rejection entry
    await this.journalService.writeEntry(run.id, 'tool:rejected', {
      toolName: run.pending_tool.toolName,
      toolCallId: run.pending_tool.toolCallId,
      reason,
    }, run.current_step);

    // Add rejection to messages so agent can see it
    const messages = run.messages || [];
    messages.push({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: run.pending_tool.toolCallId,
        result: {
          error: `Tool execution rejected: ${reason}`,
          rejected: true,
        },
      }],
    });

    await this.saveMessages(run.id, messages, run.current_step);
    await this.clearPendingTool(run.id);
  }

  /**
   * Create an approval request in the database
   */
  private async createApprovalRequest(
    run: AgentRun,
    toolCall: { toolCallId: string; toolName: string; args: unknown }
  ): Promise<void> {
    await this.approvalService.createApproval({
      runId: run.id,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: toolCall.args as Record<string, unknown>,
      stepNumber: run.current_step + 1,
    });
  }

  /**
   * Get agent configuration (model, system prompt, tools)
   */
  private getAgentConfig(agentType: string, workDir?: string): {
    model: any;
    systemPrompt: string;
    tools: Record<string, any>;
  } | null {
    const defaultWorkDir = workDir || process.cwd();
    const model = anthropic('claude-sonnet-4-20250514');

    switch (agentType) {
      case 'coding':
        return {
          model,
          systemPrompt: getCodingPrompt(),
          tools: {
            shell_command_execute: createShellTool(defaultWorkDir),
            read_file: createReadFileTool(defaultWorkDir),
            write_file: createWriteFileTool(defaultWorkDir),
            find_files: createFindFilesTool(defaultWorkDir),
            search_code: createSearchCodeTool(defaultWorkDir),
          },
        };

      case 'log-analyzer': {
        const lokiConfig = getLokiConfig();
        return {
          model,
          systemPrompt: getLogAnalyzerPrompt(),
          tools: {
            loki_query: createLokiQueryTool(lokiConfig.url),
            analyze_logs: createLogAnalysisTool(),
            generate_report: createReportGenerationTool(),
          },
        };
      }

      default:
        return null;
    }
  }

  /**
   * Extract messages from generateText result
   */
  private extractMessages(result: any, previousMessages: any[]): any[] {
    // Combine previous messages with new ones from this step
    const newMessages = result.response?.messages || [];
    return [...previousMessages, ...newMessages];
  }

  // ============ State Transitions ============

  private async transitionTo(runId: string, status: RunStatus): Promise<void> {
    await this.runRepository.update(runId, { status });
    logger.info({ runId, status }, 'Run status updated');
  }

  private async suspend(
    runId: string,
    pendingTool: { toolCallId: string; toolName: string; args: Record<string, unknown> },
    messages: any[]
  ): Promise<void> {
    await this.runRepository.update(runId, {
      status: 'suspended',
      pending_tool: pendingTool,
      messages,
    });
    logger.info({ runId, toolName: pendingTool.toolName }, 'Run suspended for approval');
  }

  private async complete(runId: string, message: string, steps?: number): Promise<void> {
    const resultData: Record<string, any> = { success: true, message };
    await this.runRepository.update(runId, {
      status: 'completed' as const,
      result: resultData,
      completed_at: new Date(),
    });
    await this.journalService.writeEntry(runId, 'run:complete', {
      success: true,
      message,
      steps: steps || 0,
    });
    logger.info({ runId }, 'Run completed');
  }

  private async fail(runId: string, error: string): Promise<void> {
    const resultData: Record<string, any> = { success: false, error };
    await this.runRepository.update(runId, {
      status: 'failed' as const,
      result: resultData,
      completed_at: new Date(),
    });
    await this.journalService.writeEntry(runId, 'run:error', { error });
    logger.error({ runId, error }, 'Run failed');
  }

  private async saveMessages(runId: string, messages: any[], step: number): Promise<void> {
    await this.runRepository.update(runId, {
      messages,
      current_step: step,
    });
  }

  private async clearPendingTool(runId: string): Promise<void> {
    await this.runRepository.update(runId, { pending_tool: null as any });
  }

  private async loadRun(runId: string): Promise<AgentRun | null> {
    return this.runRepository.findOne({ where: { id: runId } });
  }
}

// Singleton instance
export const agentRunner = new AgentRunner();
