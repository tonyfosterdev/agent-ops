import axios from 'axios';
import { AppDataSource } from '../database';
import { WarehouseRegistry } from '../entities/WarehouseRegistry';
import { WarehouseStatus, HealthCheckResponse } from '@agentops/shared';
import { config } from '../config';
import { logger } from '../logger';

export class WarehouseService {
  private warehouseRepo = AppDataSource.getRepository(WarehouseRegistry);

  async registerWarehouse(name: string, url: string, internalUrl: string): Promise<WarehouseRegistry> {
    let warehouse = await this.warehouseRepo.findOne({ where: { name } });

    if (warehouse) {
      // Update existing warehouse
      warehouse.url = url;
      warehouse.internal_url = internalUrl;
      warehouse.status = WarehouseStatus.HEALTHY;
      warehouse.last_seen = new Date();
    } else {
      // Create new warehouse
      warehouse = this.warehouseRepo.create({
        name,
        url,
        internal_url: internalUrl,
        status: WarehouseStatus.HEALTHY,
        last_seen: new Date(),
      });
    }

    return await this.warehouseRepo.save(warehouse);
  }

  async listWarehouses(): Promise<WarehouseRegistry[]> {
    return await this.warehouseRepo.find({
      order: { created_at: 'ASC' },
    });
  }

  async healthCheckAll(): Promise<void> {
    const warehouses = await this.warehouseRepo.find();

    for (const warehouse of warehouses) {
      try {
        const response = await axios.get<HealthCheckResponse>(`${warehouse.internal_url}/health`, {
          headers: {
            Authorization: `Bearer ${config.auth.serviceSecret}`,
          },
          timeout: 5000,
        });

        if (response.data.status === 'healthy') {
          warehouse.status = WarehouseStatus.HEALTHY;
          warehouse.last_seen = new Date();
        } else {
          warehouse.status = WarehouseStatus.OFFLINE;
        }
      } catch (error) {
        logger.warn({ warehouse: warehouse.name, error }, 'Warehouse health check failed');
        warehouse.status = WarehouseStatus.OFFLINE;
      }

      await this.warehouseRepo.save(warehouse);
    }
  }
}
