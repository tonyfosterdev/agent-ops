/**
 * Orchestration Agent - Intelligent routing to specialized sub-agents
 *
 * Extends BaseAgent to provide LLM-powered task routing and delegation.
 * This is a thin orchestrator that analyzes tasks and delegates to:
 * - Coding Agent (debugging, file fixes)
 * - Log Analyzer Agent (log queries, error analysis)
 * - Both agents (combined tasks)
 */

import { generateText } from 'ai';
import { BaseAgent } from 'ops-shared/base/BaseAgent';
import type { AgentConfig, AgentResult } from 'ops-shared/types';
import {
  createRunCodingAgentTool,
  createRunLogAnalyzerAgentTool,
  createRunBothAgentsTool,
} from './tools/index.js';
import { getSystemPrompt } from './prompts.js';
import type { OutputSink } from '../../sinks/OutputSink.js';
import type { ConversationContext } from '../../services/ContextService.js';

export class OrchestrationAgent extends BaseAgent {
  private runCodingAgentTool: any;
  private runLogAnalyzerAgentTool: any;
  private runBothAgentsTool: any;

  constructor(config: AgentConfig) {
    super(config);
  }

  /**
   * Initialize the orchestration agent and setup delegation tools
   */
  async initialize(): Promise<void> {
    this.log('info', 'Initializing Orchestration Agent...');

    // Create delegation tools
    this.runCodingAgentTool = createRunCodingAgentTool();
    this.runLogAnalyzerAgentTool = createRunLogAnalyzerAgentTool();
    this.runBothAgentsTool = createRunBothAgentsTool();

    this.isInitialized = true;
    this.log('info', 'Orchestration Agent initialized successfully');
  }

  /**
   * Run the orchestration agent with a task
   *
   * @param task - The task description (e.g., "Fix the auth bug and check logs for errors")
   * @param context - Conversation context from previous runs
   * @param sink - Output sink for writing execution progress
   * @returns AgentResult with execution results
   */
  async run(
    task: string,
    context: ConversationContext,
    sink: OutputSink
  ): Promise<AgentResult> {
    this.ensureInitialized();

    await sink.writeRunStarted({
      task,
      maxSteps: this.config.maxSteps,
      agentType: this.config.agentType,
    });

    // Build system prompt with context
    let systemPrompt = getSystemPrompt();
    if (context.summary) {
      systemPrompt += `\n\n## Previous Context\n${context.summary}`;
    }

    // Build messages array from context
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of context.recentMessages) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: 'user', content: task });

    try {
      let currentStepNumber = 0;

      const result = await generateText({
        model: this.model,
        maxSteps: this.config.maxSteps,
        system: systemPrompt,
        messages,
        tools: {
          run_coding_agent: this.runCodingAgentTool,
          run_log_analyzer_agent: this.runLogAnalyzerAgentTool,
          run_both_agents: this.runBothAgentsTool,
        },
        onStepFinish: async ({ text, toolCalls, toolResults }) => {
          currentStepNumber++;

          // Write text entry if there's text
          if (text) {
            await sink.writeText(text, currentStepNumber);
          }

          // Write tool entries
          for (let i = 0; i < toolCalls.length; i++) {
            const call = toolCalls[i];
            const toolResult = toolResults[i];

            await sink.writeToolStarting(
              call.toolName,
              call.toolCallId,
              call.args,
              currentStepNumber
            );

            const resultData = toolResult?.result as any;
            const success = resultData?.success || false;
            const summary = this.generateToolSummary({
              toolName: call.toolName,
              args: call.args,
              result: resultData,
            });

            await sink.writeToolComplete(
              call.toolName,
              call.toolCallId,
              resultData,
              success,
              summary,
              currentStepNumber
            );
          }

          await sink.writeStepComplete(currentStepNumber);
        },
      });

      const finalText = result.text;
      const stepsUsed = result.steps?.length || 0;

      // Determine success
      const success =
        finalText.toLowerCase().includes('task complete') ||
        finalText.toLowerCase().includes('successfully') ||
        finalText.toLowerCase().includes('completed');

      const agentResult: AgentResult = {
        success,
        message: finalText,
        steps: stepsUsed,
        trace: [],
      };

      await sink.writeRunComplete({
        success,
        message: finalText,
        steps: stepsUsed,
      });

      return agentResult;
    } catch (error: any) {
      await sink.writeRunError(error.message);

      return {
        success: false,
        message: `Agent failed: ${error.message}`,
        steps: 0,
        trace: [],
      };
    }
  }

  /**
   * Generate one-sentence summary for a tool call result
   */
  private generateToolSummary(toolResult: any): string {
    const toolName = toolResult.toolName;
    const args = toolResult.args || {};
    const result = toolResult.result || {};

    switch (toolName) {
      case 'run_coding_agent':
        const codingTask = args.task || '';
        return `Coding agent: ${result.success ? 'Completed' : 'Failed'} - ${codingTask.slice(0, 50)}${codingTask.length > 50 ? '...' : ''}`;

      case 'run_log_analyzer_agent':
        const logTask = args.task || '';
        return `Log analyzer: ${result.success ? 'Completed' : 'Failed'} - ${logTask.slice(0, 50)}${logTask.length > 50 ? '...' : ''}`;

      case 'run_both_agents':
        return `Both agents executed ${result.executionMode || 'unknown'} - ${result.success ? 'Success' : 'Failed'}`;

      default:
        return `Executed ${toolName}`;
    }
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    this.log('info', 'Shutting down Orchestration Agent...');
    this.isInitialized = false;
  }
}

/**
 * Factory function to create and initialize an orchestration agent
 *
 * @param config - Agent configuration
 * @returns Initialized OrchestrationAgent instance
 */
export async function createOrchestrationAgent(
  config: AgentConfig
): Promise<OrchestrationAgent> {
  const agent = new OrchestrationAgent(config);
  await agent.initialize();
  return agent;
}
