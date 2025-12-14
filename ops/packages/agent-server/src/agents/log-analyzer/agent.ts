/**
 * Log Analyzer Agent - Autonomous log analysis and investigation
 *
 * Extends BaseAgent to provide log querying, analysis, and reporting capabilities
 * for the distributed bookstore system using Grafana Loki.
 * NOTE: This class is used by the old agentExecutor path.
 * The new AgentRunner path uses getAgentConfig() directly.
 */

import { generateText } from 'ai';
import { BaseAgent } from 'ops-shared/base/BaseAgent';
import type { AgentConfig, AgentResult } from 'ops-shared/types';
import { getLokiConfig } from 'ops-shared/config';
import { createLokiQueryTool, createLogAnalysisTool, createReportGenerationTool } from './tools/index.js';
import { getSystemPrompt } from './prompts.js';
import type { Journal } from '../../interfaces/Journal.js';
import type { ConversationContext } from '../../services/ContextService.js';

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
   * @param context - Conversation context from previous runs
   * @param journal - Journal for writing execution progress (null for no journaling)
   * @param runId - Run ID for journal entries (null for no journaling)
   * @returns AgentResult with execution results
   */
  async run(
    task: string,
    context: ConversationContext,
    journal: Journal | null,
    runId: string | null
  ): Promise<AgentResult> {
    this.ensureInitialized();

    if (journal && runId) {
      await journal.writeEntry(runId, 'run:started', {
        task,
        maxSteps: this.config.maxSteps,
        agentType: this.config.agentType,
      });
    }

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

      // Tools for log analyzer agent
      const tools = {
        loki_query: this.lokiQueryTool,
        analyze_logs: this.logAnalysisTool,
        generate_report: this.reportGenerationTool,
      };

      const result = await generateText({
        model: this.model,
        maxSteps: this.config.maxSteps,
        system: systemPrompt,
        messages,
        tools,
        onStepFinish: async ({ text, toolCalls, toolResults }) => {
          currentStepNumber++;

          // Write text entry if there's text
          if (text && journal && runId) {
            await journal.writeEntry(runId, 'text', { text }, currentStepNumber);
          }

          // Write tool entries
          for (let i = 0; i < toolCalls.length; i++) {
            const call = toolCalls[i];
            const toolResult = toolResults[i];

            if (journal && runId) {
              await journal.writeEntry(
                runId,
                'tool:starting',
                { toolName: call.toolName, toolCallId: call.toolCallId, args: call.args },
                currentStepNumber
              );
            }

            const resultData = toolResult?.result as any;
            const success = resultData?.success !== false;
            const summary = this.generateToolSummary(call.toolName, resultData);

            if (journal && runId) {
              await journal.writeEntry(
                runId,
                'tool:complete',
                {
                  toolName: call.toolName,
                  toolCallId: call.toolCallId,
                  result: resultData,
                  success,
                  summary,
                },
                currentStepNumber
              );
            }
          }

          if (journal && runId) {
            await journal.writeEntry(runId, 'step:complete', {}, currentStepNumber);
          }
        },
      });

      const finalText = result.text;
      const stepsUsed = result.steps?.length || 0;

      // Determine success
      const lowerText = finalText.toLowerCase();
      const success =
        lowerText.includes('analysis complete') ||
        lowerText.includes('investigation complete') ||
        lowerText.includes('found') ||
        lowerText.includes('error') ||
        lowerText.includes('issue') ||
        lowerText.includes('cause');

      const agentResult: AgentResult = {
        success,
        message: finalText,
        steps: stepsUsed,
        trace: [],
      };

      if (journal && runId) {
        await journal.writeEntry(runId, 'run:complete', {
          success,
          message: finalText,
          steps: stepsUsed,
        });
        await journal.completeRun(runId, { success, message: finalText });
      }

      return agentResult;
    } catch (error: any) {
      if (journal && runId) {
        await journal.writeEntry(runId, 'run:error', { error: error.message });
        await journal.failRun(runId, error.message);
      }

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
        const count = result?.totalCount || 0;
        return `Queried logs: ${count} entries found`;

      case 'analyze_logs':
        const findings = result?.findingsCount || 0;
        return `Analyzed logs: ${findings} findings`;

      case 'generate_report':
        return `Generated ${result?.format || 'text'} report`;

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
