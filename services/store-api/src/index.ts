import { createApp } from './app';
import { initializeDatabase } from './database';
import { config } from './config';
import { startHealthCheckJob } from './jobs/healthCheckJob';
import { startInventoryReconciliationJob } from './jobs/inventoryReconciliationJob';
import { logger } from './logger';

async function main() {
  // Initialize database
  await initializeDatabase();

  // Create app
  const app = createApp();

  // Start background jobs
  startHealthCheckJob();
  startInventoryReconciliationJob();

  // Start server
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Store API started successfully');
  });
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start Store API');
  process.exit(1);
});
