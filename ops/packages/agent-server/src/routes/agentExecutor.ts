import { JournalService } from '../services/JournalService.js';
import { ContextService } from '../services/ContextService.js';
import { SessionService } from '../services/SessionService.js';
import { JournalOutputSink } from '../sinks/JournalOutputSink.js';
import { CodingAgent } from '../agents/coding/agent.js';
import { LogAnalyzerAgent } from '../agents/log-analyzer/agent.js';
import { OrchestrationAgent } from '../agents/orchestration/agent.js';
import { MockAgent } from '../agents/mock/agent.js';
import { loadConfig } from 'ops-shared';
import { logger } from '../config.js';

export type AgentType = 'coding' | 'log-analyzer' | 'orchestration' | 'mock';

/**
 * Execute an agent with journal-based output.
 * This function runs in the background and writes progress to the journal via OutputSink.
 */
export async function executeAgentWithJournal(
  runId: string,
  agentType: AgentType,
  task: string,
  sessionId: string,
  config?: Record<string, any>
): Promise<void> {
  const journalService = new JournalService();
  const contextService = new ContextService(journalService);
  const sessionService = new SessionService();

  try {
    // Build context from session history
    const context = await contextService.buildContext(sessionId);

    // Create the appropriate agent
    let agent: CodingAgent | LogAnalyzerAgent | OrchestrationAgent | MockAgent;

    switch (agentType) {
      case 'coding': {
        const agentConfig = loadConfig('coding', config);
        agent = new CodingAgent(agentConfig);
        break;
      }
      case 'log-analyzer': {
        const agentConfig = loadConfig('log-analyzer', config);
        agent = new LogAnalyzerAgent(agentConfig);
        break;
      }
      case 'orchestration': {
        const agentConfig = loadConfig('orchestration', config);
        agent = new OrchestrationAgent(agentConfig);
        break;
      }
      case 'mock':
        // Mock agent doesn't need full config loading
        agent = new MockAgent({ agentType: 'mock', maxSteps: config?.maxSteps || 10 });
        break;
      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }

    logger.info({ runId, agentType, task }, 'Starting agent execution');

    // Initialize agent
    await agent.initialize();

    // Create output sink for journal writes
    const sink = new JournalOutputSink(runId, journalService);

    try {
      // Run with output sink
      await agent.run(task, context, sink);

      // Update session timestamp
      await sessionService.updateSessionTimestamp(sessionId);

      logger.info({ runId, agentType }, 'Agent execution completed');
    } finally {
      // Always shutdown agent
      await agent.shutdown();
    }
  } catch (error: any) {
    logger.error({ error: error.message, runId, agentType }, 'Agent execution failed');

    // Write error to journal
    await journalService.writeEntry(runId, 'run:error', {
      error: error.message,
    });
    await journalService.failRun(runId, error.message);
  }
}
