/**
 * Event emitter for agent execution events
 * Provides a typed interface for emitting and listening to agent events
 */

import { EventEmitter } from 'events';
import type { AgentEvent } from './types';

export class AgentEventEmitter extends EventEmitter {
  private agentId: string;

  constructor(agentType: string) {
    super();
    // Generate unique agent ID: agentType-timestamp-random
    this.agentId = `${agentType}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Emit an agent event
   * Automatically adds agentId to the event
   */
  emitAgentEvent(event: AgentEvent): boolean {
    return super.emit('agent-event', { ...event, agentId: this.agentId });
  }

  /**
   * Listen to all agent events
   */
  onEvent(listener: (event: AgentEvent) => void): void {
    this.on('agent-event', listener);
  }

  /**
   * Stop listening to agent events
   */
  offEvent(listener: (event: AgentEvent) => void): void {
    this.off('agent-event', listener);
  }

  /**
   * Get the unique ID for this agent instance
   */
  getAgentId(): string {
    return this.agentId;
  }
}
