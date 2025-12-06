import axios from 'axios';
import { AppDataSource } from '../database';
import { ShipmentLog } from '../entities/ShipmentLog';
import { InventoryService } from './inventoryService';
import { ShipmentInstructionRequest, ShipmentConfirmationResponse, OrderStatus } from '@agentops/shared';
import { config } from '../config';
import { logger } from '../logger';

export class ShipmentService {
  private shipmentLogRepo = AppDataSource.getRepository(ShipmentLog);
  private inventoryService = new InventoryService();

  async processShipment(instruction: ShipmentInstructionRequest): Promise<ShipmentConfirmationResponse> {
    const { orderId, items } = instruction;

    // Validate all items have sufficient stock
    for (const item of items) {
      const inventory = await this.inventoryService.getInventoryByBook(item.bookId);
      if (!inventory || inventory.quantity < item.quantity) {
        throw new Error(`Insufficient stock for book ${item.bookId} (ISBN: ${item.isbn})`);
      }
    }

    // Decrement inventory and log shipment
    for (const item of items) {
      await this.inventoryService.decrementQuantity(item.bookId, item.quantity);

      const shipmentLog = this.shipmentLogRepo.create({
        order_id: orderId,
        book_id: item.bookId,
        isbn: item.isbn,
        quantity: item.quantity,
      });
      await this.shipmentLogRepo.save(shipmentLog);
    }

    const shippedAt = new Date();

    // Notify Store API
    await this.notifyStore(orderId, shippedAt);

    return {
      orderId,
      warehouseName: config.warehouse.name,
      shipped: true,
      shippedAt,
    };
  }

  private async notifyStore(orderId: string, shippedAt: Date): Promise<void> {
    try {
      await axios.patch(
        `${config.store.apiUrl}/orders/${orderId}/status`,
        {
          status: OrderStatus.SHIPPED,
          shippedAt,
        },
        {
          headers: {
            Authorization: `Bearer ${config.auth.serviceSecret}`,
          },
          timeout: 5000,
        }
      );
      logger.info({ orderId }, 'Notified Store of shipment');
    } catch (error) {
      logger.error({ orderId, error }, 'Failed to notify Store of shipment');
    }
  }

  async getShipmentHistory(): Promise<ShipmentLog[]> {
    return await this.shipmentLogRepo.find({
      order: { shipped_at: 'DESC' },
    });
  }
}
