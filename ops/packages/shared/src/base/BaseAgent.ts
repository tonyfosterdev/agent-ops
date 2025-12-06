/**
 * Abstract base class for all agents
 *
 * Provides common lifecycle management, configuration, error handling,
 * and event emission for all agents.
 */

import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV1 } from 'ai';
import type { AgentConfig, AgentResult } from '../types';
import { AgentEventEmitter } from '../events/AgentEventEmitter';
import type { AgentEvent, AgentEventType } from '../events/types';

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected model: LanguageModelV1;
  protected isInitialized: boolean = false;
  protected eventEmitter: AgentEventEmitter;

  constructor(config: AgentConfig) {
    this.config = config;
    this.model = anthropic(config.model);
    this.eventEmitter = new AgentEventEmitter(config.agentType);
  }

  /**
   * Initialize the agent (setup tools, connections, etc.)
   * Must be called before run()
   */
  abstract initialize(): Promise<void>;

  /**
   * Run the agent with a given task
   *
   * @param task - The task description/prompt
   * @returns AgentResult with success status, message, steps, and trace
   */
  abstract run(task: string): Promise<AgentResult>;

  /**
   * Cleanup resources (close connections, etc.)
   * Should be called after agent completes or on error
   */
  abstract shutdown(): Promise<void>;

  /**
   * Check if agent is initialized
   */
  protected ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }
  }

  /**
   * Log message based on log level
   */
  protected log(level: 'info' | 'debug' | 'error', message: string, data?: any): void {
    const shouldLog =
      level === 'error' ||
      (level === 'info' && this.config.logLevel !== 'error') ||
      (level === 'debug' && this.config.logLevel === 'debug');

    if (shouldLog) {
      const prefix = `[${this.config.agentType}:${level.toUpperCase()}]`;
      if (data) {
        console.log(prefix, message, data);
      } else {
        console.log(prefix, message);
      }
    }
  }

  /**
   * Get agent type (for identification)
   */
  getAgentType(): string {
    return this.config.agentType;
  }

  /**
   * Get agent configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Get event emitter for external listeners
   * Allows UI layer to subscribe to agent events
   */
  getEventEmitter(): AgentEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Emit an agent event
   * Helper method that automatically fills in common fields
   */
  protected emitEvent(event: Partial<AgentEvent> & { type: AgentEventType }): void {
    this.eventEmitter.emitAgentEvent({
      ...event,
      agentId: this.eventEmitter.getAgentId(),
      timestamp: Date.now(),
      agentType: this.config.agentType,
    } as AgentEvent);
  }
}
