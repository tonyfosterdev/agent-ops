import cron from 'node-cron';
import { InventoryService } from '../services/inventoryService';
import { config } from '../config';
import { logger } from '../logger';

const inventoryService = new InventoryService();

export function startInventoryReconciliationJob(): void {
  const intervalSeconds = config.jobs.inventoryReconciliationIntervalSeconds;
  const cronExpression = `*/${intervalSeconds} * * * * *`;

  cron.schedule(cronExpression, async () => {
    await inventoryService.reconcileInventory();
  });

  logger.info({ intervalSeconds }, 'Inventory reconciliation job started');
}
