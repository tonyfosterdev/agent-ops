import cron from 'node-cron';
import { WarehouseService } from '../services/warehouseService';
import { config } from '../config';
import { logger } from '../logger';

const warehouseService = new WarehouseService();

export function startHealthCheckJob(): void {
  const intervalSeconds = config.jobs.healthCheckIntervalSeconds;
  const cronExpression = `*/${intervalSeconds} * * * * *`;

  cron.schedule(cronExpression, async () => {
    logger.info('Running warehouse health checks');
    await warehouseService.healthCheckAll();
  });

  logger.info({ intervalSeconds }, 'Health check job started');
}
