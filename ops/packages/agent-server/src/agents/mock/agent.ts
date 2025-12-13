/**
 * Mock Agent for Testing
 *
 * A simple agent that writes predefined entries to the OutputSink
 * without calling the Claude API. Used for integration testing.
 */

import type { OutputSink } from '../../sinks/OutputSink.js';
import type { AgentResult } from 'ops-shared';
import type { ConversationContext } from '../../services/ContextService.js';

export interface MockAgentConfig {
  agentType: string;
  maxSteps: number;
  steps?: MockStep[];
  shouldFail?: boolean;
  failAtStep?: number;
  delayMs?: number;
}

export interface MockStep {
  text?: string;
  tool?: {
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    success: boolean;
    summary: string;
  };
}

const DEFAULT_STEPS: MockStep[] = [
  {
    text: 'Starting mock task execution...',
    tool: {
      name: 'mockTool',
      args: { input: 'test' },
      result: { output: 'mock result' },
      success: true,
      summary: 'Mock tool executed successfully',
    },
  },
];

export class MockAgent {
  private config: MockAgentConfig;
  private isInitialized: boolean = false;

  constructor(config: Partial<MockAgentConfig> = {}) {
    this.config = {
      agentType: config.agentType || 'mock',
      maxSteps: config.maxSteps || 10,
      steps: config.steps || DEFAULT_STEPS,
      shouldFail: config.shouldFail || false,
      failAtStep: config.failAtStep,
      delayMs: config.delayMs || 0,
    };
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
  }

  async shutdown(): Promise<void> {
    this.isInitialized = false;
  }

  async run(
    task: string,
    context: ConversationContext,
    sink: OutputSink
  ): Promise<AgentResult> {
    if (!this.isInitialized) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    const steps = this.config.steps || DEFAULT_STEPS;

    // Write run started
    await sink.writeRunStarted({
      task,
      maxSteps: this.config.maxSteps,
      agentType: this.config.agentType,
    });

    // Optional delay to simulate processing
    if (this.config.delayMs) {
      await this.delay(this.config.delayMs);
    }

    let stepNumber = 0;

    try {
      for (const step of steps) {
        stepNumber++;

        // Check if we should fail at this step
        if (this.config.failAtStep === stepNumber) {
          throw new Error(`Simulated failure at step ${stepNumber}`);
        }

        // Write text if present
        if (step.text) {
          await sink.writeText(step.text, stepNumber);
        }

        // Write tool execution if present
        if (step.tool) {
          const toolCallId = `mock-call-${stepNumber}`;

          await sink.writeToolStarting(
            step.tool.name,
            toolCallId,
            step.tool.args,
            stepNumber
          );

          // Optional delay to simulate tool execution
          if (this.config.delayMs) {
            await this.delay(this.config.delayMs / 2);
          }

          await sink.writeToolComplete(
            step.tool.name,
            toolCallId,
            step.tool.result,
            step.tool.success,
            step.tool.summary,
            stepNumber
          );
        }

        await sink.writeStepComplete(stepNumber);
      }

      // Check if we should fail at the end
      if (this.config.shouldFail) {
        throw new Error('Simulated agent failure');
      }

      const message = `Mock agent completed ${stepNumber} step(s) for task: ${task}`;

      await sink.writeRunComplete({
        success: true,
        message,
        steps: stepNumber,
      });

      return {
        success: true,
        message,
        steps: stepNumber,
        trace: [], // Empty trace for mock agent
      };
    } catch (error: any) {
      await sink.writeRunError(error.message);

      return {
        success: false,
        message: error.message,
        steps: stepNumber,
        trace: [], // Empty trace for mock agent
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getAgentType(): string {
    return this.config.agentType;
  }
}

/**
 * Create a mock agent with custom configuration
 */
export function createMockAgent(config?: Partial<MockAgentConfig>): MockAgent {
  return new MockAgent(config);
}
