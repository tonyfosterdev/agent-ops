/**
 * Mock Agent for Testing
 *
 * A simple agent that writes predefined entries to the Journal
 * without calling the Claude API. Used for integration testing.
 */

import type { Journal } from '../../interfaces/Journal.js';
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
    journal: Journal | null,
    runId: string | null
  ): Promise<AgentResult> {
    if (!this.isInitialized) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    const steps = this.config.steps || DEFAULT_STEPS;

    // Write run started
    if (journal && runId) {
      await journal.writeEntry(runId, 'run:started', {
        task,
        maxSteps: this.config.maxSteps,
        agentType: this.config.agentType,
      });
    }

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
        if (step.text && journal && runId) {
          await journal.writeEntry(runId, 'text', { text: step.text }, stepNumber);
        }

        // Write tool execution if present
        if (step.tool) {
          const toolCallId = `mock-call-${stepNumber}`;

          if (journal && runId) {
            await journal.writeEntry(
              runId,
              'tool:starting',
              { toolName: step.tool.name, toolCallId, args: step.tool.args },
              stepNumber
            );
          }

          // Optional delay to simulate tool execution
          if (this.config.delayMs) {
            await this.delay(this.config.delayMs / 2);
          }

          if (journal && runId) {
            await journal.writeEntry(
              runId,
              'tool:complete',
              {
                toolName: step.tool.name,
                toolCallId,
                result: step.tool.result,
                success: step.tool.success,
                summary: step.tool.summary,
              },
              stepNumber
            );
          }
        }

        if (journal && runId) {
          await journal.writeEntry(runId, 'step:complete', {}, stepNumber);
        }
      }

      // Check if we should fail at the end
      if (this.config.shouldFail) {
        throw new Error('Simulated agent failure');
      }

      const message = `Mock agent completed ${stepNumber} step(s) for task: ${task}`;

      if (journal && runId) {
        await journal.writeEntry(runId, 'run:complete', {
          success: true,
          message,
          steps: stepNumber,
        });
        await journal.completeRun(runId, { success: true, message });
      }

      return {
        success: true,
        message,
        steps: stepNumber,
        trace: [], // Empty trace for mock agent
      };
    } catch (error: any) {
      if (journal && runId) {
        await journal.writeEntry(runId, 'run:error', { error: error.message });
        await journal.failRun(runId, error.message);
      }

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
