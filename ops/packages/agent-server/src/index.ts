import { serve } from '@hono/node-server';
import { config, logger } from './config';
import { createApp } from './app';

async function main() {
  try {
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

    logger.info(`🚀 Agent Server running at http://localhost:${port}`);
    logger.info(`Health check: http://localhost:${port}/health`);

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully...');
      process.exit(0);
    });
  } catch (error) {
    logger.error(error, 'Fatal error starting server');
    process.exit(1);
  }
}

main();
