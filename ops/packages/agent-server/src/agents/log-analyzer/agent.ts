/**
 * Log Analyzer Agent - Autonomous log analysis and investigation
 *
 * Extends BaseAgent to provide log querying, analysis, and reporting capabilities
 * for the distributed bookstore system using Grafana Loki.
 */

import { streamText } from 'ai';
import { BaseAgent } from 'ops-shared/base/BaseAgent';
import type { AgentConfig, AgentResult } from 'ops-shared/types';
import { getLokiConfig } from 'ops-shared/config';
import { createLokiQueryTool, createLogAnalysisTool, createReportGenerationTool } from './tools';
import { getSystemPrompt } from './prompts';
import { processStream } from '../../utils/streamingHelper';

export class LogAnalyzerAgent extends BaseAgent {
  private lokiQueryTool: any;
  private logAnalysisTool: any;
  private reportGenerationTool: any;
  private lokiUrl: string;

  constructor(config: AgentConfig) {
    super(config);
    const lokiConfig = getLokiConfig();
    this.lokiUrl = lokiConfig.url;
  }

  /**
   * Initialize the log analyzer agent and setup tools
   */
  async initialize(): Promise<void> {
    this.log('info', 'Initializing Log Analyzer Agent...');

    // Create tools
    this.lokiQueryTool = createLokiQueryTool(this.lokiUrl);
    this.logAnalysisTool = createLogAnalysisTool();
    this.reportGenerationTool = createReportGenerationTool();

    this.isInitialized = true;
    this.log('info', `Log Analyzer Agent initialized (Loki URL: ${this.lokiUrl})`);
  }

  /**
   * Run the log analyzer agent with an investigation task
   *
   * @param task - The investigation description (e.g., "Why is warehouse-alpha failing?")
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
    console.log('LOG ANALYZER AGENT STARTING');
    console.log(`${'='.repeat(60)}`);
    console.log(`Task: ${task}`);
    console.log(`Max Steps: ${this.config.maxSteps}`);
    console.log(`Loki URL: ${this.lokiUrl}`);
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
          loki_query: this.lokiQueryTool,
          analyze_logs: this.logAnalysisTool,
          generate_report: this.reportGenerationTool,
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
          const success = res?.success !== false;
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
      console.log('LOG ANALYZER AGENT COMPLETED');
      console.log(`${'='.repeat(60)}`);
      console.log(`Steps Used: ${stepsUsed}/${this.config.maxSteps}`);
      console.log(`${'='.repeat(60)}\n`);

      // Determine success based on final response
      const lowerText = finalText.toLowerCase();
      const success =
        lowerText.includes('analysis complete') ||
        lowerText.includes('investigation complete') ||
        lowerText.includes('found') ||
        lowerText.includes('error') ||
        lowerText.includes('issue') ||
        lowerText.includes('cause') ||
        lowerText.includes('stack trace') ||
        lowerText.includes('location:') ||
        lowerText.includes('service:') ||
        lowerText.includes('the problem');

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
      console.error('\n❌ LOG ANALYZER AGENT ERROR:');
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
      case 'loki_query':
        const count = result.totalCount || 0;
        return `Queried logs: ${count} entries found`;

      case 'analyze_logs':
        const findings = result.findingsCount || 0;
        return `Analyzed logs: ${findings} findings`;

      case 'generate_report':
        return `Generated ${result.format || 'text'} report`;

      default:
        return `Executed ${toolName}`;
    }
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    this.log('info', 'Shutting down Log Analyzer Agent...');
    this.isInitialized = false;
  }
}

/**
 * Factory function to create and initialize a log analyzer agent
 *
 * @param config - Agent configuration
 * @returns Initialized LogAnalyzerAgent instance
 */
export async function createLogAnalyzerAgent(config: AgentConfig): Promise<LogAnalyzerAgent> {
  const agent = new LogAnalyzerAgent(config);
  await agent.initialize();
  return agent;
}
