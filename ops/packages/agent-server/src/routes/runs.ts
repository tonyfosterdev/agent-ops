import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { journalService } from '../services/JournalService';
import { startRun, resumeRun, runAgentStep } from '../services/DurableLoop';
import { logger } from '../config';
import type { RunStatus, AgentType } from '../types/journal';

const runsRouter = new Hono();

/**
 * POST /runs - Create a new run
 */
runsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const { prompt, user_id, agent_type = 'orchestrator' } = body;

  if (!prompt || !user_id) {
    return c.json({ error: 'prompt and user_id are required' }, 400);
  }

  // Validate agent type
  const validAgentTypes: AgentType[] = ['orchestrator', 'coding', 'log-analyzer'];
  if (!validAgentTypes.includes(agent_type as AgentType)) {
    return c.json({ error: `Invalid agent_type. Must be one of: ${validAgentTypes.join(', ')}` }, 400);
  }

  try {
    const runId = await startRun(prompt, user_id, agent_type as AgentType);
    return c.json({ id: runId, status: 'pending' }, 201);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to create run');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /runs - List runs with pagination
 */
runsRouter.get('/', async (c) => {
  const userId = c.req.query('user_id');
  const status = c.req.query('status') as RunStatus | undefined;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    const { runs, total } = await journalService.listRuns({
      userId,
      status,
      limit,
      offset,
    });

    return c.json({
      runs: runs.map((run) => ({
        id: run.id,
        user_id: run.user_id,
        prompt: run.prompt,
        status: run.status,
        current_step: run.current_step,
        agent_type: run.agent_type,
        parent_run_id: run.parent_run_id,
        created_at: run.created_at,
        updated_at: run.updated_at,
        completed_at: run.completed_at,
      })),
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to list runs');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /runs/:id - Get run details with journal
 */
runsRouter.get('/:id', async (c) => {
  const runId = c.req.param('id');

  try {
    const run = await journalService.getRunWithEntries(runId);

    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    // Find pending tool if suspended
    const pendingTool = run.status === 'suspended'
      ? journalService.findPendingTool(run.entries)
      : null;

    return c.json({
      id: run.id,
      user_id: run.user_id,
      prompt: run.prompt,
      status: run.status,
      current_step: run.current_step,
      agent_type: run.agent_type,
      parent_run_id: run.parent_run_id,
      created_at: run.created_at,
      updated_at: run.updated_at,
      completed_at: run.completed_at,
      pending_tool: pendingTool,
      events: run.entries.map((entry) => ({
        id: entry.id,
        sequence: entry.sequence,
        type: entry.event_type,
        payload: entry.payload,
        created_at: entry.created_at,
      })),
    });
  } catch (error: any) {
    logger.error({ error: error.message, runId }, 'Failed to get run');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /runs/:id/events/snapshot - Get limited events as JSON (for inline child run display)
 */
runsRouter.get('/:id/events/snapshot', async (c) => {
  const runId = c.req.param('id');
  const limitParam = c.req.query('limit');

  try {
    // Validate run exists
    const run = await journalService.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    // Parse and constrain limit (1-500, default 100)
    const parsedLimit = parseInt(limitParam || '100', 10);
    const limit = Math.min(500, Math.max(1, Number.isNaN(parsedLimit) ? 100 : parsedLimit));

    // Get limited events
    const events = await journalService.getEventsLimited(runId, limit);

    // Get total count
    const totalCount = await journalService.getEventCount(runId);

    // Compute pending_tool from ALL events when suspended, not just the limited set
    // This ensures the client can use limit=1 for efficiency and still get the correct pending_tool
    let pendingTool = null;
    if (run.status === 'suspended') {
      const allEvents = await journalService.getEvents(runId);
      pendingTool = journalService.findPendingToolFromEntries(allEvents);
    }

    return c.json({
      run_id: runId,
      status: run.status,
      events: events.map((e) => ({
        id: e.id,
        sequence: e.sequence,
        type: e.event_type,
        payload: e.payload,
        created_at: e.created_at,
      })),
      total_count: totalCount,
      pending_tool: pendingTool,
    });
  } catch (error: any) {
    logger.error({ error: error.message, runId }, 'Failed to get events snapshot');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /runs/:id/events - SSE stream of events
 */
runsRouter.get('/:id/events', async (c) => {
  const runId = c.req.param('id');

  const run = await journalService.getRun(runId);
  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    let lastSequence = -1;

    // Send initial events
    const initialEvents = await journalService.getEvents(runId);
    for (const event of initialEvents) {
      await stream.writeSSE({
        data: JSON.stringify({
          id: event.id,
          sequence: event.sequence,
          type: event.event_type,
          payload: event.payload,
          created_at: event.created_at,
        }),
        event: 'event',
        id: event.id,
      });
      lastSequence = event.sequence;
    }

    // Poll for new events
    const pollInterval = 500; // 500ms
    const maxPolls = 600; // 5 minutes max

    for (let i = 0; i < maxPolls; i++) {
      // Check if client disconnected
      if (stream.aborted) {
        break;
      }

      // Check current run status
      const currentRun = await journalService.getRun(runId);
      if (!currentRun) break;

      // Get new events
      const newEvents = await journalService.getEventsSince(runId, lastSequence);

      for (const event of newEvents) {
        await stream.writeSSE({
          data: JSON.stringify({
            id: event.id,
            sequence: event.sequence,
            type: event.event_type,
            payload: event.payload,
            created_at: event.created_at,
          }),
          event: 'event',
          id: event.id,
        });
        lastSequence = event.sequence;
      }

      // Exit if run is in terminal state
      if (currentRun.status === 'completed' || currentRun.status === 'failed' || currentRun.status === 'cancelled') {
        await stream.writeSSE({
          data: JSON.stringify({ status: currentRun.status }),
          event: 'done',
        });
        break;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  });
});

/**
 * POST /runs/:id/resume - Resume a suspended run
 */
runsRouter.post('/:id/resume', async (c) => {
  const runId = c.req.param('id');
  const body = await c.req.json();
  const { decision, feedback } = body;

  if (!decision || !['approved', 'rejected'].includes(decision)) {
    return c.json({ error: 'decision must be "approved" or "rejected"' }, 400);
  }

  try {
    await resumeRun(runId, decision, feedback);
    return c.json({ success: true });
  } catch (error: any) {
    logger.error({ error: error.message, runId }, 'Failed to resume run');
    return c.json({ error: error.message }, 400);
  }
});

/**
 * POST /runs/:id/retry - Retry a failed or suspended run
 */
runsRouter.post('/:id/retry', async (c) => {
  const runId = c.req.param('id');

  try {
    const run = await journalService.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    if (run.status === 'running') {
      return c.json({ error: 'Run is already running' }, 400);
    }

    // Resume the run
    await journalService.updateStatus(runId, 'running');
    runAgentStep(runId).catch((error) => {
      logger.error({ runId, error: error.message }, 'Retry failed');
    });

    return c.json({ success: true });
  } catch (error: any) {
    logger.error({ error: error.message, runId }, 'Failed to retry run');
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /runs/:id/cancel - Cancel a running or suspended run
 *
 * NOTE: This only updates the database state. It does NOT interrupt any
 * currently executing agent processes. The agent loop will see the status
 * change on its next iteration and stop gracefully.
 *
 * TODO: Child runs are not automatically cancelled. If this run has spawned
 * child runs, they will continue executing. Consider implementing cascading
 * cancellation in the future.
 */
runsRouter.post('/:id/cancel', async (c) => {
  const runId = c.req.param('id');

  try {
    const run = await journalService.getRun(runId);
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }

    // Can only cancel runs that are not already in terminal state
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return c.json({ error: `Cannot cancel run in ${run.status} state` }, 400);
    }

    // Log the cancellation event
    await journalService.appendEvent(runId, {
      type: 'RUN_CANCELLED',
      payload: {
        reason: 'Cancelled by user',
        cancelled_by: 'user',
      },
    });

    // Update status to cancelled
    await journalService.updateStatus(runId, 'cancelled');

    logger.info({ runId }, 'Run cancelled by user');
    return c.json({ success: true });
  } catch (error: any) {
    logger.error({ error: error.message, runId }, 'Failed to cancel run');
    return c.json({ error: error.message }, 500);
  }
});

export default runsRouter;
