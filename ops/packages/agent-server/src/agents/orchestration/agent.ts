/**
 * Orchestration Agent - Intelligent routing to specialized sub-agents
 *
 * Extends BaseAgent to provide LLM-powered task routing and delegation.
 * This is a thin orchestrator that analyzes tasks and delegates to:
 * - Coding Agent (debugging, file fixes)
 * - Log Analyzer Agent (log queries, error analysis)
 * - Both agents (combined tasks)
 */

import { streamText } from 'ai';
import { BaseAgent } from 'ops-shared/base/BaseAgent';
import type { AgentConfig, AgentResult } from 'ops-shared/types';
import {
  createRunCodingAgentTool,
  createRunLogAnalyzerAgentTool,
  createRunBothAgentsTool,
} from './tools';
import { getSystemPrompt } from './prompts';
import { processStream } from '../../utils/streamingHelper';

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
   * @returns AgentResult with execution results
   */
  async run(task: string): Promise<AgentResult> {
    this.ensureInitialized();

    // Emit agent start event
    this.emitEvent({
      type: 'agent:start',
      task,
      maxSteps: this.config.maxSteps,
    });

    // Display task with horizontal rules (Claude Code style)
    const terminalWidth = process.stdout.columns || 80;
    const horizontalRule = '─'.repeat(terminalWidth);

    console.log(`\n${horizontalRule}`);
    console.log(`Task: ${task}`);
    console.log(`${horizontalRule}\n`);

    try {
      // Track step number for events
      let currentStepNumber = 1;
      let stepText = '';

      // Emit initial step start
      this.emitEvent({
        type: 'step:start',
        stepNumber: currentStepNumber,
      });

      // Execute agent loop with streamText for real-time feedback
      const result = await streamText({
        model: this.model,
        maxSteps: this.config.maxSteps,
        system: getSystemPrompt(),
        prompt: task,
        tools: {
          run_coding_agent: this.runCodingAgentTool,
          run_log_analyzer_agent: this.runLogAnalyzerAgentTool,
          run_both_agents: this.runBothAgentsTool,
        },
        // Enable tool call streaming for early notification
        experimental_toolCallStreaming: true,
      });

      // Process stream and emit real-time events
      await processStream(result, {
        onTextChunk: (chunk, isComplete) => {
          if (chunk) {
            // Write to console in real-time
            process.stdout.write(chunk);
            stepText += chunk;
          }

          // Emit streaming text event
          this.emitEvent({
            type: 'step:text_chunk',
            stepNumber: currentStepNumber,
            chunk,
            isComplete,
          });
        },

        onToolCallStreamingStart: (toolCallId, toolName) => {
          // Emit early notification that a tool is being called
          this.emitEvent({
            type: 'step:tool_call_streaming_start',
            stepNumber: currentStepNumber,
            toolName,
            toolCallId,
          });
        },

        onToolCall: (toolCallId, toolName, args) => {
          console.log(`\n⋯ ${toolName}...`);

          // Emit tool call start event (args now complete)
          this.emitEvent({
            type: 'step:tool_call_start',
            stepNumber: currentStepNumber,
            toolName,
            toolCallId,
            args,
          });
        },

        onToolResult: (toolCallId, toolName, resultData) => {
          const res = resultData as any;
          const success = res?.success || false;
          const icon = success ? '✓' : '✗';
          const summary = this.generateToolSummary({
            toolName,
            args: {},
            result: res,
          });
          console.log(`${icon} ${summary}`);

          // Emit tool call complete event
          this.emitEvent({
            type: 'step:tool_call_complete',
            stepNumber: currentStepNumber,
            toolName,
            result: resultData,
            success,
            summary,
          });
        },

        onStepComplete: (stepNumber) => {
          // Emit text complete for this step (with accumulated text)
          if (stepText) {
            this.emitEvent({
              type: 'step:text_complete',
              stepNumber: currentStepNumber,
              text: stepText,
            });
            stepText = '';
          }

          // Emit step complete event
          this.emitEvent({
            type: 'step:complete',
            stepNumber: currentStepNumber,
          });

          console.log('');

          // Prepare for next step
          currentStepNumber++;
          this.emitEvent({
            type: 'step:start',
            stepNumber: currentStepNumber,
          });
        },

        onError: (error) => {
          this.log('error', 'Stream error', error);
        },
      });

      // Get final result after stream completes
      const finalText = await result.text;
      const steps = await result.steps;
      const stepsUsed = steps?.length || 0;

      // Display final response with horizontal rules
      console.log(`\n${horizontalRule}`);
      console.log(`Steps: ${stepsUsed}/${this.config.maxSteps}`);
      console.log(`${horizontalRule}\n`);

      // Determine success based on final response
      const success =
        finalText.toLowerCase().includes('task complete') ||
        finalText.toLowerCase().includes('successfully') ||
        finalText.toLowerCase().includes('completed');

      const agentResult: AgentResult = {
        success,
        message: finalText,
        steps: stepsUsed,
        trace: [], // Could be populated from steps if needed
      };

      // Emit agent complete event
      this.emitEvent({
        type: 'agent:complete',
        result: agentResult,
      });

      return agentResult;
    } catch (error: any) {
      this.log('error', 'Agent execution failed', error);
      console.error('\n❌ ORCHESTRATION AGENT ERROR:');
      console.error(error.message);

      // Emit agent error event
      this.emitEvent({
        type: 'agent:error',
        error: error.message,
      });

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
