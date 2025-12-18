import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { journalService } from '../services/JournalService';
import { startRun, resumeRun, runAgentStep } from '../services/DurableLoop';
import { logger } from '../config';
import type { RunStatus } from '../types/journal';

const runsRouter = new Hono();

/**
 * POST /runs - Create a new run
 */
runsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const { prompt, user_id } = body;

  if (!prompt || !user_id) {
    return c.json({ error: 'prompt and user_id are required' }, 400);
  }

  try {
    const runId = await startRun(prompt, user_id);
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
      if (currentRun.status === 'completed' || currentRun.status === 'failed') {
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

export default runsRouter;
