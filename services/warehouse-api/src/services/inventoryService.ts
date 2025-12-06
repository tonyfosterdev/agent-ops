import { AppDataSource } from '../database';
import { Inventory } from '../entities/Inventory';
import { StockQueryResponse } from '@agentops/shared';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';

export class InventoryService {
  private inventoryRepo = AppDataSource.getRepository(Inventory);

  async getAllInventory(): Promise<any[]> {
    const inventory = await this.inventoryRepo.find();

    // Fetch book details from Store API to enrich inventory with titles/authors
    const enrichedInventory = await Promise.all(
      inventory.map(async (item) => {
        try {
          const response = await axios.get(`${config.store.apiUrl}/books`);
          const book = response.data.find((b: any) => b.id === item.book_id);

          return {
            bookId: item.book_id,
            isbn: item.isbn,
            quantity: item.quantity,
            title: book?.title || 'Unknown',
            author: book?.author || 'Unknown',
          };
        } catch (error) {
          logger.error({ bookId: item.book_id, error }, 'Failed to fetch book details');
          return {
            bookId: item.book_id,
            isbn: item.isbn,
            quantity: item.quantity,
            title: 'Unknown',
            author: 'Unknown',
          };
        }
      })
    );

    return enrichedInventory;
  }

  async getInventoryByBook(bookId: string): Promise<Inventory | null> {
    return await this.inventoryRepo.findOne({ where: { book_id: bookId } });
  }

  async setInventory(bookId: string, isbn: string, quantity: number): Promise<Inventory> {
    let inventory = await this.inventoryRepo.findOne({ where: { book_id: bookId } });

    if (inventory) {
      inventory.quantity = quantity;
      inventory.isbn = isbn;
    } else {
      inventory = this.inventoryRepo.create({
        book_id: bookId,
        isbn,
        quantity,
      });
    }

    return await this.inventoryRepo.save(inventory);
  }

  async updateQuantity(bookId: string, quantity: number): Promise<Inventory | null> {
    const inventory = await this.inventoryRepo.findOne({ where: { book_id: bookId } });
    if (!inventory) {
      throw new Error('Inventory item not found');
    }

    inventory.quantity = quantity;
    return await this.inventoryRepo.save(inventory);
  }

  async decrementQuantity(bookId: string, amount: number): Promise<void> {
    const inventory = await this.inventoryRepo.findOne({ where: { book_id: bookId } });
    if (!inventory) {
      throw new Error(`Inventory not found for book ${bookId}`);
    }

    if (inventory.quantity < amount) {
      throw new Error(`Insufficient stock for book ${bookId}. Available: ${inventory.quantity}, Requested: ${amount}`);
    }

    inventory.quantity -= amount;
    await this.inventoryRepo.save(inventory);
  }
}
