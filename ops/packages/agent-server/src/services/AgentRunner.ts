import { EventEmitter } from 'events';
import { loadConfig, type AgentConfig, type AgentResult } from 'ops-shared';
import { type AgentEvent } from 'ops-shared/events/types';
import { CodingAgent } from '../agents/coding/agent';
import { LogAnalyzerAgent } from '../agents/log-analyzer/agent';
import { OrchestrationAgent } from '../agents/orchestration/agent';

export type AgentType = 'coding' | 'log-analyzer' | 'orchestration';

export class AgentRunner extends EventEmitter {
  private agentType: AgentType;
  private config: AgentConfig;

  constructor(agentType: AgentType, configOverrides?: Partial<AgentConfig>) {
    super();
    this.agentType = agentType;

    // Load agent-specific config with overrides
    this.config = loadConfig(agentType, configOverrides);
  }

  async run(task: string): Promise<AgentResult> {
    const agent = this.createAgent();

    // Subscribe to agent events and forward them to SSE stream
    agent.getEventEmitter().onEvent((event: AgentEvent) => {
      this.emit('event', event);
    });

    try {
      // Initialize and run agent
      await agent.initialize();
      const result = await agent.run(task);
      await agent.shutdown();
      return result;
    } catch (error: any) {
      await agent.shutdown();
      throw error;
    }
  }

  private createAgent() {
    switch (this.agentType) {
      case 'coding':
        return new CodingAgent(this.config);
      case 'log-analyzer':
        return new LogAnalyzerAgent(this.config);
      case 'orchestration':
        return new OrchestrationAgent(this.config);
      default:
        throw new Error(`Unknown agent type: ${this.agentType}`);
    }
  }
}
