import 'reflect-metadata';
import { serve } from '@hono/node-server';
import { config, logger } from './config';
import { createApp } from './app';
import { initializeDatabase, closeDatabase } from './database';

async function main() {
  try {
    // Initialize database first
    logger.info('Initializing database connection...');
    await initializeDatabase();

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
