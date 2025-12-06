import axios from 'axios';
import { AppDataSource } from '../database';
import { Order } from '../entities/Order';
import { OrderItem } from '../entities/OrderItem';
import { Payment } from '../entities/Payment';
import { Book } from '../entities/Book';
import { InventoryCache } from '../entities/InventoryCache';
import { WarehouseRegistry } from '../entities/WarehouseRegistry';
import { OrderStatus, WarehouseStatus, ShipmentInstructionRequest } from '@agentops/shared';
import { config } from '../config';
import { logger } from '../logger';

interface OrderItemInput {
  bookId: string;
  quantity: number;
}

interface PaymentInput {
  method: string;
  amount: number;
}

export class OrderService {
  private orderRepo = AppDataSource.getRepository(Order);
  private orderItemRepo = AppDataSource.getRepository(OrderItem);
  private paymentRepo = AppDataSource.getRepository(Payment);
  private bookRepo = AppDataSource.getRepository(Book);
  private inventoryCacheRepo = AppDataSource.getRepository(InventoryCache);
  private warehouseRepo = AppDataSource.getRepository(WarehouseRegistry);

  async createOrder(
    userId: string,
    items: OrderItemInput[],
    payment: PaymentInput
  ): Promise<Order> {
    // 1. Validate books and calculate total
    let total = 0;
    const validatedItems = [];

    for (const item of items) {
      const book = await this.bookRepo.findOne({ where: { id: item.bookId } });
      if (!book) {
        throw new Error(`Book ${item.bookId} not found`);
      }
      validatedItems.push({ book, quantity: item.quantity });
      total += parseFloat(book.price.toString()) * item.quantity;
    }

    // 2. Select warehouse that has complete stock
    const warehouse = await this.selectWarehouse(items);
    if (!warehouse) {
      throw new Error('No warehouse has sufficient stock for this order');
    }

    // 3. Create order
    const order = this.orderRepo.create({
      user_id: userId,
      status: OrderStatus.PENDING,
      total,
      fulfillment_warehouse_id: warehouse.id,
    });
    await this.orderRepo.save(order);

    // 4. Create order items
    for (const { book, quantity } of validatedItems) {
      const orderItem = this.orderItemRepo.create({
        order_id: order.id,
        book_id: book.id,
        quantity,
        price: book.price,
      });
      await this.orderItemRepo.save(orderItem);
    }

    // 5. Create payment record
    const paymentRecord = this.paymentRepo.create({
      order_id: order.id,
      method: payment.method,
      amount: payment.amount,
    });
    await this.paymentRepo.save(paymentRecord);

    // 6. Send shipment instruction to warehouse
    await this.sendShipmentInstruction(order, warehouse, validatedItems);

    return order;
  }

  private async selectWarehouse(items: OrderItemInput[]): Promise<WarehouseRegistry | null> {
    const warehouses = await this.warehouseRepo.find({
      where: { status: WarehouseStatus.HEALTHY },
    });

    for (const warehouse of warehouses) {
      let hasAllStock = true;

      for (const item of items) {
        const cache = await this.inventoryCacheRepo.findOne({
          where: { book_id: item.bookId, warehouse_id: warehouse.id },
        });

        if (!cache || cache.quantity < item.quantity) {
          hasAllStock = false;
          break;
        }
      }

      if (hasAllStock) {
        return warehouse;
      }
    }

    return null;
  }

  private async sendShipmentInstruction(
    order: Order,
    warehouse: WarehouseRegistry,
    items: Array<{ book: Book; quantity: number }>
  ): Promise<void> {
    const payload: ShipmentInstructionRequest = {
      orderId: order.id,
      items: items.map((item) => ({
        bookId: item.book.id,
        isbn: item.book.isbn,
        quantity: item.quantity,
      })),
    };

    try {
      const response = await axios.post(`${warehouse.internal_url}/shipments`, payload, {
        headers: {
          Authorization: `Bearer ${config.auth.serviceSecret}`,
        },
        timeout: 10000,
      });

      if (response.data.shipped) {
        await this.updateOrderStatus(order.id, OrderStatus.SHIPPED, new Date(response.data.shippedAt));
      }
    } catch (error) {
      logger.error({ warehouse: warehouse.name, error }, 'Failed to send shipment instruction to warehouse');
      throw new Error('Failed to process shipment with warehouse');
    }
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, shippedAt?: Date): Promise<void> {
    await this.orderRepo.update(orderId, { status, shipped_at: shippedAt });

    // Update inventory cache when shipped
    if (status === OrderStatus.SHIPPED) {
      const order = await this.orderRepo.findOne({
        where: { id: orderId },
        relations: ['items'],
      });

      if (order) {
        for (const item of order.items) {
          await this.inventoryCacheRepo.decrement(
            { book_id: item.book_id, warehouse_id: order.fulfillment_warehouse_id },
            'quantity',
            item.quantity
          );
        }
      }
    }
  }

  async getUserOrders(userId: string): Promise<Order[]> {
    return await this.orderRepo.find({
      where: { user_id: userId },
      relations: ['items', 'items.book', 'payments'],
      order: { created_at: 'DESC' },
    });
  }

  async getAllOrders(): Promise<Order[]> {
    return await this.orderRepo.find({
      relations: ['user', 'items', 'items.book', 'payments'],
      order: { created_at: 'DESC' },
    });
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.book', 'payments', 'fulfillment_warehouse'],
    });
  }
}
