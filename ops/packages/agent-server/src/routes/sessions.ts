import { Hono } from 'hono';
import { z } from 'zod';
import { SessionService } from '../services/SessionService.js';
import { JournalService } from '../services/JournalService.js';
import { ContextService } from '../services/ContextService.js';
import { agentRunner } from '../services/AgentRunner.js';
import { logger } from '../config.js';

const app = new Hono();

const createSessionSchema = z.object({
  agentType: z.enum(['coding', 'log-analyzer', 'orchestration', 'mock']),
  title: z.string().optional(),
});

const createRunSchema = z.object({
  task: z.string().min(1),
  config: z
    .object({
      maxSteps: z.number().optional(),
      model: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /sessions
 * Create a new session
 */
app.post('/', async (c) => {
  const sessionService = new SessionService();

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON in request body' }, 400);
  }

  const validation = createSessionSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Invalid request', details: validation.error.errors }, 400);
  }

  const { agentType, title } = validation.data;
  const sessionId = await sessionService.createSession(agentType, title);

  logger.info({ sessionId, agentType }, 'Session created');

  return c.json(
    {
      sessionId,
      runUrl: `/sessions/${sessionId}/runs`,
    },
    201
  );
});

/**
 * GET /sessions
 * List sessions with optional filters
 */
app.get('/', async (c) => {
  const sessionService = new SessionService();

  const status = c.req.query('status') as 'active' | 'archived' | undefined;
  const agentType = c.req.query('agentType');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const sessions = await sessionService.listSessions({
    status,
    agentType,
    limit,
    offset,
  });

  // Transform to camelCase for API response
  const transformed = sessions.map((session) => ({
    id: session.id,
    agentType: session.agent_type,
    title: session.title,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  }));

  return c.json(transformed);
});

/**
 * GET /sessions/:sessionId
 * Get session details with runs
 */
app.get('/:sessionId', async (c) => {
  const sessionService = new SessionService();
  const journalService = new JournalService();

  const sessionId = c.req.param('sessionId');
  const session = await sessionService.getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const runs = await journalService.getRunsForSession(sessionId);

  // Transform runs to exclude full entries for listing
  const runsWithoutEntries = runs.map((run) => ({
    id: run.id,
    runNumber: run.run_number,
    agentType: run.agent_type,
    task: run.task,
    status: run.status,
    config: run.config,
    result: run.result,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
  }));

  return c.json({
    session: {
      id: session.id,
      agentType: session.agent_type,
      title: session.title,
      status: session.status,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    },
    runs: runsWithoutEntries,
  });
});

/**
 * POST /sessions/:sessionId/runs
 * Start a new run in an existing session
 */
app.post('/:sessionId/runs', async (c) => {
  const sessionService = new SessionService();
  const journalService = new JournalService();

  const sessionId = c.req.param('sessionId');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON in request body' }, 400);
  }

  const validation = createRunSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: 'Invalid request', details: validation.error.errors }, 400);
  }

  const session = await sessionService.getSession(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const { task, config } = validation.data;
  const runId = await journalService.createRun(sessionId, session.agent_type, task, config);

  logger.info({ runId, sessionId, task }, 'Run created in session');

  // Start agent execution in background using new state machine runner
  agentRunner.start(runId).catch((error) => {
    logger.error({ error: error.message, runId }, 'Agent execution failed');
  });

  return c.json(
    {
      runId,
      subscribeUrl: `/runs/${runId}/subscribe`,
    },
    201
  );
});

/**
 * POST /sessions/:sessionId/archive
 * Archive a session
 */
app.post('/:sessionId/archive', async (c) => {
  const sessionService = new SessionService();

  const sessionId = c.req.param('sessionId');
  const session = await sessionService.getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  await sessionService.archiveSession(sessionId);
  logger.info({ sessionId }, 'Session archived');

  return c.json({ success: true });
});

export default app;
