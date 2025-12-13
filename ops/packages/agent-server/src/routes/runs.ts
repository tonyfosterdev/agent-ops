import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { JournalService } from '../services/JournalService.js';
import { logger } from '../config.js';

const app = new Hono();

/**
 * GET /runs/:runId
 * Get run details with journal entries
 */
app.get('/:runId', async (c) => {
  const journalService = new JournalService();

  const runId = c.req.param('runId');
  const run = await journalService.getRunWithOrderedEntries(runId);

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  return c.json({
    run: {
      id: run.id,
      sessionId: run.session_id,
      runNumber: run.run_number,
      agentType: run.agent_type,
      task: run.task,
      status: run.status,
      config: run.config,
      result: run.result,
      contextSummary: run.context_summary,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      createdAt: run.created_at,
    },
    entries: run.entries.map((entry) => ({
      id: entry.id,
      entryType: entry.entry_type,
      stepNumber: entry.step_number,
      data: entry.data,
      createdAt: entry.created_at,
    })),
  });
});

/**
 * GET /runs/:runId/subscribe
 * Subscribe to run updates via Server-Sent Events
 */
app.get('/:runId/subscribe', async (c) => {
  const journalService = new JournalService();

  const runId = c.req.param('runId');
  const run = await journalService.getRun(runId);

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  logger.info({ runId }, 'Client subscribing to run updates');

  return stream(c, async (stream) => {
    let lastSequence = 0;
    let isComplete = false;
    let pollCount = 0;
    const maxPollTime = 10 * 60 * 1000; // 10 minutes max
    const startTime = Date.now();

    // Poll for new entries
    while (!isComplete) {
      const entries = await journalService.getEntriesSince(runId, lastSequence);

      for (const entry of entries) {
        await stream.writeln(
          `data: ${JSON.stringify({
            type: 'entry',
            entry: {
              id: entry.id,
              entry_type: entry.entry_type,
              step_number: entry.step_number,
              data: entry.data,
              created_at: entry.created_at,
            },
          })}`
        );

        lastSequence = entry.sequence_number;

        // Check for completion entries
        if (entry.entry_type === 'run:complete' || entry.entry_type === 'run:error') {
          isComplete = true;
        }
      }

      if (!isComplete) {
        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, 100));
        pollCount++;

        // Periodically check if run status changed (every 10 polls)
        if (pollCount % 10 === 0) {
          const currentRun = await journalService.getRun(runId);
          if (currentRun?.status === 'completed' || currentRun?.status === 'failed') {
            isComplete = true;
          }
        }

        // Timeout safety
        if (Date.now() - startTime > maxPollTime) {
          logger.warn({ runId }, 'SSE subscription timed out');
          isComplete = true;
        }
      }
    }

    // Send final complete event
    const finalRun = await journalService.getRun(runId);
    await stream.writeln(
      `data: ${JSON.stringify({
        type: 'complete',
        run: {
          id: finalRun?.id,
          status: finalRun?.status,
          result: finalRun?.result,
        },
      })}`
    );

    logger.info({ runId }, 'SSE subscription completed');
  });
});

export default app;
