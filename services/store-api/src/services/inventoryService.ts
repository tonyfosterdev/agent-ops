import axios from 'axios';
import { AppDataSource } from '../database';
import { InventoryCache } from '../entities/InventoryCache';
import { WarehouseRegistry } from '../entities/WarehouseRegistry';
import { Book } from '../entities/Book';
import { WarehouseStatus, StockQueryResponse } from '@agentops/shared';
import { config } from '../config';
import { logger } from '../logger';

export class InventoryService {
  private inventoryCacheRepo = AppDataSource.getRepository(InventoryCache);
  private warehouseRepo = AppDataSource.getRepository(WarehouseRegistry);
  private bookRepo = AppDataSource.getRepository(Book);

  async reconcileInventory(): Promise<void> {
    logger.info('Starting inventory reconciliation');

    const warehouses = await this.warehouseRepo.find({
      where: { status: WarehouseStatus.HEALTHY },
    });

    const books = await this.bookRepo.find({ where: { is_active: true } });

    for (const warehouse of warehouses) {
      try {
        // Query warehouse for all inventory
        const response = await axios.get<StockQueryResponse[]>(`${warehouse.internal_url}/inventory`, {
          headers: {
            Authorization: `Bearer ${config.auth.serviceSecret}`,
          },
          timeout: 10000,
        });

        // Update cache for each book
        for (const stockItem of response.data) {
          const book = books.find((b) => b.id === stockItem.bookId);
          if (!book) continue;

          let cache = await this.inventoryCacheRepo.findOne({
            where: { book_id: book.id, warehouse_id: warehouse.id },
          });

          if (cache) {
            cache.quantity = stockItem.quantity;
            cache.last_synced = new Date();
          } else {
            cache = this.inventoryCacheRepo.create({
              book_id: book.id,
              warehouse_id: warehouse.id,
              quantity: stockItem.quantity,
              last_synced: new Date(),
            });
          }

          await this.inventoryCacheRepo.save(cache);
        }

        logger.info({ warehouse: warehouse.name }, 'Reconciled inventory for warehouse');
      } catch (error) {
        logger.error({ warehouse: warehouse.name, error }, 'Failed to reconcile inventory for warehouse');
      }
    }

    logger.info('Inventory reconciliation completed');
  }

  async getBookInventory(bookId: string): Promise<{ warehouseName: string; quantity: number }[]> {
    const cacheRecords = await this.inventoryCacheRepo.find({
      where: { book_id: bookId },
      relations: ['warehouse'],
    });

    return cacheRecords.map((record) => ({
      warehouseName: record.warehouse.name,
      quantity: record.quantity,
    }));
  }
}
