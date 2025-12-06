/**
 * Coding Agent - Autonomous debugging and bug fixing
 *
 * Extends BaseAgent to provide systematic code debugging and fixing capabilities.
 */

import { streamText } from 'ai';
import { BaseAgent } from 'ops-shared/base/BaseAgent';
import type { AgentConfig, AgentResult } from 'ops-shared/types';
import {
  createShellTool,
  createReadFileTool,
  createWriteFileTool,
  createFindFilesTool,
  createSearchCodeTool,
} from './tools';
import { getSystemPrompt } from './prompts';
import { processStream } from '../../utils/streamingHelper';

export class CodingAgent extends BaseAgent {
  private shellTool: any;
  private readFileTool: any;
  private writeFileTool: any;
  private findFilesTool: any;
  private searchCodeTool: any;

  constructor(config: AgentConfig) {
    super(config);
  }

  /**
   * Initialize the coding agent and setup tools
   */
  async initialize(): Promise<void> {
    this.log('info', 'Initializing Coding Agent...');

    // Create tools with working directory
    this.shellTool = createShellTool(this.config.workDir);
    this.readFileTool = createReadFileTool(this.config.workDir);
    this.writeFileTool = createWriteFileTool(this.config.workDir);
    this.findFilesTool = createFindFilesTool(this.config.workDir);
    this.searchCodeTool = createSearchCodeTool(this.config.workDir);

    this.isInitialized = true;
    this.log('info', 'Coding Agent initialized successfully');
  }

  /**
   * Run the coding agent with a debugging task
   *
   * @param task - The task description (e.g., "Fix test-cases/app.ts")
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

    console.log(`\n${'='.repeat(60)}`);
    console.log('CODING AGENT STARTING');
    console.log(`${'='.repeat(60)}`);
    console.log(`Task: ${task}`);
    console.log(`Max Steps: ${this.config.maxSteps}`);
    console.log(`${'-'.repeat(60)}\n`);

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
          shell_command_execute: this.shellTool,
          read_file: this.readFileTool,
          write_file: this.writeFileTool,
          find_files: this.findFilesTool,
          search_code: this.searchCodeTool,
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
          const success = res?.success !== false && res?.exitCode === 0;
          const summary = this.generateToolSummary(toolName, res);
          const icon = success ? '✓' : '✗';
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

      console.log(`\n${'='.repeat(60)}`);
      console.log('CODING AGENT COMPLETED');
      console.log(`${'='.repeat(60)}`);
      console.log(`Steps Used: ${stepsUsed}/${this.config.maxSteps}`);
      console.log(`${'='.repeat(60)}\n`);

      // Determine success based on final response
      const lowerText = finalText.toLowerCase();
      const success =
        lowerText.includes('task complete') ||
        lowerText.includes('successfully fixed') ||
        lowerText.includes('bug fixed') ||
        lowerText.includes('fixed the') ||
        lowerText.includes('have fixed') ||
        lowerText.includes('has been fixed') ||
        lowerText.includes('issue resolved') ||
        lowerText.includes('error resolved') ||
        lowerText.includes('removed the') ||
        lowerText.includes('file changed:') ||
        lowerText.includes('line(s) modified:');

      const agentResult: AgentResult = {
        success,
        message: finalText,
        steps: stepsUsed,
        trace: [],
      };

      // Emit agent complete event
      this.emitEvent({
        type: 'agent:complete',
        result: agentResult,
      });

      return agentResult;
    } catch (error: any) {
      this.log('error', 'Agent execution failed', error);
      console.error('\n❌ CODING AGENT ERROR:');
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
  private generateToolSummary(toolName: string, result: any): string {
    switch (toolName) {
      case 'shell_command_execute':
        const cmd = result.command || '';
        const shortCmd = cmd.length > 40 ? cmd.slice(0, 40) + '...' : cmd;
        return result.exitCode === 0
          ? `Executed: ${shortCmd}`
          : `Failed (exit ${result.exitCode}): ${shortCmd}`;

      case 'read_file':
        return `Read file: ${result.path || 'unknown'}`;

      case 'write_file':
        return `Wrote file: ${result.path || 'unknown'}`;

      case 'find_files':
        const count = result.files?.length || 0;
        return `Found ${count} file(s)`;

      case 'search_code':
        const matches = result.matches?.length || 0;
        return `Found ${matches} match(es)`;

      default:
        return `Executed ${toolName}`;
    }
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    this.log('info', 'Shutting down Coding Agent...');
    this.isInitialized = false;
  }
}

/**
 * Factory function to create and initialize a coding agent
 *
 * @param config - Agent configuration
 * @returns Initialized CodingAgent instance
 */
export async function createCodingAgent(config: AgentConfig): Promise<CodingAgent> {
  const agent = new CodingAgent(config);
  await agent.initialize();
  return agent;
}
