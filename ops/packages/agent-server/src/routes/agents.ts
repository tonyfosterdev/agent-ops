import { Hono } from 'hono';
import { z } from 'zod';
import { SessionService } from '../services/SessionService.js';
import { JournalService } from '../services/JournalService.js';
import { agentRunner } from '../services/AgentRunner.js';
import { logger } from '../config.js';
import type { AgentTypeInfo, ListAgentsResponse } from 'ops-shared';

type AgentType = 'coding' | 'log-analyzer' | 'orchestration' | 'mock';

const app = new Hono();

// Request validation schema
const runAgentSchema = z.object({
  task: z.string().min(1, 'Task cannot be empty'),
  sessionId: z.string().uuid().optional(),
  config: z
    .object({
      maxSteps: z.number().optional(),
      model: z.string().optional(),
      workDir: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /agents/:type/run
 *
 * Start agent execution with journal-based output.
 * Returns runId and sessionId immediately, client subscribes via /runs/:runId/subscribe
 */
app.post('/:type/run', async (c) => {
  const agentType = c.req.param('type') as AgentType;

  // Validate agent type
  const validTypes: AgentType[] = ['coding', 'log-analyzer', 'orchestration', 'mock'];
  if (!validTypes.includes(agentType)) {
    return c.json({ error: 'Invalid agent type', validTypes }, 400);
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON in request body' }, 400);
  }

  const validation = runAgentSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      {
        error: 'Invalid request',
        details: validation.error.errors,
      },
      400
    );
  }

  const { task, sessionId: existingSessionId, config } = validation.data;

  const sessionService = new SessionService();
  const journalService = new JournalService();

  // Create or use existing session
  let sessionId = existingSessionId;
  if (!sessionId) {
    sessionId = await sessionService.createSession(agentType);
    logger.info({ sessionId, agentType }, 'New session created');
  }

  // Create run record
  const runId = await journalService.createRun(sessionId, agentType, task, config);

  logger.info({ runId, sessionId, agentType, task }, 'Starting agent execution');

  // Start agent execution in background using new state machine runner
  agentRunner.start(runId).catch((error) => {
    logger.error({ error: error.message, runId }, 'Agent execution failed');
  });

  // Return immediately with run info (HTTP 202 Accepted)
  return c.json(
    {
      runId,
      sessionId,
      subscribeUrl: `/runs/${runId}/subscribe`,
    },
    202
  );
});

/**
 * GET /agents/types
 *
 * List available agent types
 */
app.get('/types', (c) => {
  const agents: AgentTypeInfo[] = [
    { type: 'coding', description: 'Debug and fix TypeScript bugs' },
    { type: 'log-analyzer', description: 'Analyze Grafana/Loki logs' },
    { type: 'orchestration', description: 'Intelligent task routing' },
  ];

  const response: ListAgentsResponse = { agents };
  return c.json(response);
});

export default app;
