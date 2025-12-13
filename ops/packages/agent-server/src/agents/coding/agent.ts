/**
 * Coding Agent - Autonomous debugging and bug fixing
 *
 * Extends BaseAgent to provide systematic code debugging and fixing capabilities.
 */

import { generateText } from 'ai';
import { BaseAgent } from 'ops-shared/base/BaseAgent';
import type { AgentConfig, AgentResult } from 'ops-shared/types';
import {
  createShellTool,
  createReadFileTool,
  createWriteFileTool,
  createFindFilesTool,
  createSearchCodeTool,
} from './tools/index.js';
import { getSystemPrompt } from './prompts.js';
import type { OutputSink } from '../../sinks/OutputSink.js';
import type { ConversationContext } from '../../services/ContextService.js';

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
          shell_command_execute: this.shellTool,
          read_file: this.readFileTool,
          write_file: this.writeFileTool,
          find_files: this.findFilesTool,
          search_code: this.searchCodeTool,
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
            const success = resultData?.success !== false && resultData?.exitCode !== 1;
            const summary = this.generateToolSummary(call.toolName, resultData);

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
      const lowerText = finalText.toLowerCase();
      const success =
        lowerText.includes('task complete') ||
        lowerText.includes('successfully fixed') ||
        lowerText.includes('bug fixed') ||
        lowerText.includes('fixed the') ||
        lowerText.includes('have fixed') ||
        lowerText.includes('has been fixed') ||
        lowerText.includes('issue resolved') ||
        lowerText.includes('error resolved');

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
  private generateToolSummary(toolName: string, result: any): string {
    switch (toolName) {
      case 'shell_command_execute':
        const cmd = result?.command || '';
        const shortCmd = cmd.length > 40 ? cmd.slice(0, 40) + '...' : cmd;
        return result?.exitCode === 0
          ? `Executed: ${shortCmd}`
          : `Failed (exit ${result?.exitCode}): ${shortCmd}`;

      case 'read_file':
        return `Read file: ${result?.path || 'unknown'}`;

      case 'write_file':
        return `Wrote file: ${result?.path || 'unknown'}`;

      case 'find_files':
        const count = result?.files?.length || 0;
        return `Found ${count} file(s)`;

      case 'search_code':
        const matches = result?.matches?.length || 0;
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
