import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { journalService, EnrichedJournalEvent } from '../services/JournalService';
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
 * GET /runs/:id/events - SSE stream of events with subscription-based push
 *
 * Uses EventEmitter pub/sub instead of polling. Automatically subscribes
 * to child runs when CHILD_RUN_STARTED events are detected.
 *
 * Terminal state detection is event-driven: when RUN_COMPLETED, RUN_CANCELLED,
 * or SYSTEM_ERROR events arrive for the parent run, the stream is closed.
 * NO POLLING is used.
 */
runsRouter.get('/:id/events', async (c) => {
  const runId = c.req.param('id');

  const run = await journalService.getRun(runId);
  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Track ALL subscriptions for cleanup
    const unsubscribers = new Map<string, () => void>();
    const subscribedRuns = new Set<string>();
    const sentSequences = new Map<string, Set<number>>();

    // Promise that resolves when the stream should close
    let resolveStreamEnd: ((status: string) => void) | null = null;
    const streamEndPromise = new Promise<string>((resolve) => {
      resolveStreamEnd = resolve;
    });

    // Terminal event types that should close the stream (only for parent run)
    const TERMINAL_EVENTS = new Set(['RUN_COMPLETED', 'RUN_CANCELLED', 'SYSTEM_ERROR']);

    // Helper to send an event through SSE
    const sendEvent = async (event: EnrichedJournalEvent): Promise<void> => {
      // Dedupe by run_id + sequence
      const runSeqs = sentSequences.get(event.source_run_id) || new Set();
      if (runSeqs.has(event.sequence)) return;
      runSeqs.add(event.sequence);
      sentSequences.set(event.source_run_id, runSeqs);

      await stream.writeSSE({
        data: JSON.stringify({
          id: event.id,
          sequence: event.sequence,
          type: event.event_type,
          payload: event.payload,
          created_at: event.created_at,
          source_run_id: event.source_run_id,
          source_agent_type: event.source_agent_type,
        }),
        event: 'event',
        id: event.id,
      });

      // Check for terminal events on the PARENT run only
      if (event.source_run_id === runId && TERMINAL_EVENTS.has(event.event_type)) {
        // Map event type to status
        let status = 'completed';
        if (event.event_type === 'RUN_CANCELLED') status = 'cancelled';
        else if (event.event_type === 'SYSTEM_ERROR') status = 'failed';
        resolveStreamEnd?.(status);
      }
    };

    // Subscribe to a run and recursively subscribe to child runs
    const subscribeToRun = async (targetRunId: string): Promise<void> => {
      // SYNCHRONOUSLY mark as subscribed BEFORE any async work (fixes race condition)
      if (subscribedRuns.has(targetRunId)) return;
      subscribedRuns.add(targetRunId);

      try {
        // Get run metadata and cache agent type
        const targetRun = await journalService.getRun(targetRunId);
        const agentType = targetRun?.agent_type ?? null;
        journalService.cacheAgentType(targetRunId, agentType);

        // SUBSCRIBE FIRST to capture events during fetch (fixes race condition)
        const pendingEvents: EnrichedJournalEvent[] = [];
        const tempUnsub = journalService.subscribe(targetRunId, (event) => {
          pendingEvents.push(event);
        });
        unsubscribers.set(targetRunId, tempUnsub);

        // Fetch existing events
        const existingEvents = await journalService.getEvents(targetRunId);
        const existingSequences = new Set(existingEvents.map((e) => e.sequence));

        // Send existing events with source metadata
        for (const event of existingEvents) {
          const enriched: EnrichedJournalEvent = {
            id: event.id,
            sequence: event.sequence,
            event_type: event.event_type,
            payload: event.payload,
            created_at: event.created_at,
            source_run_id: targetRunId,
            source_agent_type: agentType,
          };
          await sendEvent(enriched);

          // Subscribe to child runs
          if (event.event_type === 'CHILD_RUN_STARTED') {
            const childRunId = (event.payload as { child_run_id: string }).child_run_id;
            if (childRunId) {
              await subscribeToRun(childRunId);
            }
          }
        }

        // Send any queued events (dedupe by sequence)
        for (const event of pendingEvents) {
          if (!existingSequences.has(event.sequence)) {
            await sendEvent(event);
            if (event.event_type === 'CHILD_RUN_STARTED') {
              const childRunId = (event.payload as { child_run_id: string }).child_run_id;
              if (childRunId) {
                await subscribeToRun(childRunId);
              }
            }
          }
        }

        // Replace temporary subscription with live one
        unsubscribers.get(targetRunId)?.();
        const liveUnsub = journalService.subscribe(targetRunId, async (event) => {
          await sendEvent(event);
          if (event.event_type === 'CHILD_RUN_STARTED') {
            const childRunId = (event.payload as { child_run_id: string }).child_run_id;
            if (childRunId) {
              await subscribeToRun(childRunId);
            }
          }
        });
        unsubscribers.set(targetRunId, liveUnsub);
      } catch (error) {
        subscribedRuns.delete(targetRunId); // Cleanup on failure
        logger.error({ error, runId: targetRunId }, 'Failed to subscribe to run');
        throw error;
      }
    };

    // Start with parent run
    await subscribeToRun(runId);

    // Check if run is already in terminal state (handle reconnects)
    const currentRun = await journalService.getRun(runId);
    if (
      currentRun &&
      (currentRun.status === 'completed' ||
        currentRun.status === 'failed' ||
        currentRun.status === 'cancelled')
    ) {
      await stream.writeSSE({
        data: JSON.stringify({ status: currentRun.status }),
        event: 'done',
      });
    } else {
      // Wait for terminal event - abort is handled by stream cleanup on disconnect.
      // The streamEndPromise resolves when a terminal event (RUN_COMPLETED, RUN_CANCELLED,
      // SYSTEM_ERROR) is received. The stream will be cleaned up automatically when
      // the client disconnects.
      const status = await streamEndPromise;
      if (!stream.aborted) {
        await stream.writeSSE({
          data: JSON.stringify({ status }),
          event: 'done',
        });
      }
    }

    // Cleanup all subscriptions
    for (const unsub of unsubscribers.values()) {
      unsub();
    }
    unsubscribers.clear();
    subscribedRuns.clear();

    // Clean up agent type cache for all subscribed runs
    for (const cachedRunId of sentSequences.keys()) {
      journalService.cleanupCache(cachedRunId);
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
