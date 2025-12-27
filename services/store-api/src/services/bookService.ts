import { AppDataSource } from '../database';
import { Book } from '../entities/Book';
import { InventoryCache } from '../entities/InventoryCache';

export class BookService {
  private bookRepo = AppDataSource.getRepository(Book);
  private inventoryCacheRepo = AppDataSource.getRepository(InventoryCache);

  async listBooks(): Promise<Array<Book & { total_inventory: number }>> {
    const books = await this.bookRepo.find({ where: { is_active: true } });

    // Attach aggregated inventory
    const booksWithInventory = await Promise.all(
      books.map(async (book) => {
        const inventoryRecords = await this.inventoryCacheRepo.find({
          where: { book_id: book.id },
        });
        const total_inventory = inventoryRecords.reduce((sum, inv) => sum + inv.quantity, 0);
        return {
          ...book,
          price: typeof book.price === 'string' ? parseFloat(book.price) : book.price,
          total_inventory
        };
      })
    );

    return booksWithInventory;
  }

  async getBook(id: string): Promise<Book | null> {
    const book = await this.bookRepo.findOne({ where: { id } });
    if (book && typeof book.price === 'string') {
      book.price = parseFloat(book.price) as any;
    }
    return book;
  }

  async createBook(data: Partial<Book>): Promise<Book> {
    const book = this.bookRepo.create(data);
    return await this.bookRepo.save(book);
  }

  async updateBook(id: string, data: Partial<Book>): Promise<Book | null> {
    await this.bookRepo.update(id, data);
    return await this.getBook(id);
  }

  async deleteBook(id: string): Promise<void> {
    await this.bookRepo.update(id, { is_active: false });
  }
}