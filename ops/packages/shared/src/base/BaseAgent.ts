/**
 * Abstract base class for all agents
 *
 * Provides common lifecycle management, configuration, and logging.
 */

import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV1 } from 'ai';
import type { AgentConfig, AgentResult } from '../types';

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected model: LanguageModelV1;
  protected isInitialized: boolean = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.model = anthropic(config.model);
  }

  /**
   * Initialize the agent (setup tools, connections, etc.)
   * Must be called before run()
   */
  abstract initialize(): Promise<void>;

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
}
