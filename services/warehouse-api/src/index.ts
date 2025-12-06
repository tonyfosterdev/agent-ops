import { createApp } from './app';
import { initializeDatabase } from './database';
import { config } from './config';
import { RegistrationService } from './services/registrationService';
import { logger } from './logger';

async function main() {
  // Initialize database
  await initializeDatabase();

  // Create app
  const app = createApp();

  // Start server
  const server = app.listen(config.port, () => {
    logger.info({ warehouse: config.warehouse.name, port: config.port }, 'Warehouse API started successfully');
  });

  // Wait for server to be listening
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });

  // Register with Store after server is up
  const registrationService = new RegistrationService();
  await registrationService.registerWithRetry();
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start Warehouse API');
  process.exit(1);
});
