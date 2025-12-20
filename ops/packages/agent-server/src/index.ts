import 'reflect-metadata';
import { serve } from '@hono/node-server';
import { config, logger } from './config';
import { createApp } from './app';
import { initializeDatabase, closeDatabase, AppDataSource } from './database';
import { Run } from './entities/Run';
import { journalService } from './services/JournalService';

/**
 * Clean up orphaned child runs after server startup.
 * An orphaned run is a non-terminal child run whose parent has already completed/failed.
 */
async function cleanupOrphanedRuns(): Promise<void> {
  const orphans = await AppDataSource.getRepository(Run)
    .createQueryBuilder('child')
    .innerJoin('runs', 'parent', 'parent.id = child.parent_run_id')
    .where('child.status NOT IN (:...childStatuses)', { childStatuses: ['completed', 'failed'] })
    .andWhere('parent.status IN (:...parentStatuses)', { parentStatuses: ['completed', 'failed'] })
    .getMany();

  for (const orphan of orphans) {
    await journalService.appendEvent(orphan.id, {
      type: 'SYSTEM_ERROR',
      payload: { error_details: 'Run orphaned due to parent completion' },
    });
    await journalService.updateStatus(orphan.id, 'failed');
  }

  if (orphans.length > 0) {
    logger.info({ count: orphans.length }, 'Cleaned up orphaned runs');
  }
}

async function main() {
  try {
    // Initialize database first
    logger.info('Initializing database connection...');
    await initializeDatabase();

    // Clean up any orphaned runs from previous server session
    await cleanupOrphanedRuns();

    // Create Hono app
    const app = createApp();
    const port = config.port;

    logger.info(`Agent Server starting on port ${port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`Work directory: ${config.workDir}`);

    // Start server
    serve({
      fetch: app.fetch,
      port,
    });

    logger.info(`Agent Server running at http://localhost:${port}`);
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`Runs API: http://localhost:${port}/runs`);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      await closeDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error(error, 'Fatal error starting server');
    process.exit(1);
  }
}

main();
