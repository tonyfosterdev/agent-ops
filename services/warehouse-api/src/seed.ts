import { AppDataSource } from './database';
import { User } from './entities/User';
import { Inventory } from './entities/Inventory';
import { UserRole } from '@agentops/shared';
import bcrypt from 'bcrypt';
import { config } from './config';
import axios from 'axios';

async function seedWarehouse() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const inventoryRepo = AppDataSource.getRepository(Inventory);

  console.log(`🌱 Seeding Warehouse database: ${config.warehouse.name}...`);

  // Seed Users
  const warehouseName = config.warehouse.name;
  const email = `staff@${warehouseName}.com`;

  const existing = await userRepo.findOne({ where: { email } });
  if (!existing) {
    const password_hash = await bcrypt.hash('staff123', 10);
    const user = userRepo.create({
      email,
      password_hash,
      role: UserRole.WAREHOUSE_STAFF,
      first_name: warehouseName.charAt(0).toUpperCase() + warehouseName.slice(1),
      last_name: 'Staff',
    });
    await userRepo.save(user);
    console.log(`✅ Created user: ${email}`);
  }

  // Seed Inventory
  // Fetch books from Store API to get their IDs
  console.log('Fetching books from Store API...');
  const storeApiUrl = process.env.STORE_API_URL || 'http://store-api:3000';
  let booksMap: Record<string, string> = {};

  try {
    const response = await axios.get(`${storeApiUrl}/books`);
    booksMap = response.data.reduce((acc: Record<string, string>, book: any) => {
      acc[book.isbn] = book.id;
      return acc;
    }, {});
    console.log(`✅ Fetched ${Object.keys(booksMap).length} books from Store API`);
  } catch (error) {
    console.error('❌ Failed to fetch books from Store API:', error);
    console.log('⚠️  Skipping inventory seeding - run reconciliation after Store is ready');
    await AppDataSource.destroy();
    return;
  }

  const inventoryData = [
    { isbn: '978-0-06-112008-4', quantity: warehouseName.includes('alpha') ? 25 : 15 },
    { isbn: '978-0-7432-7356-5', quantity: warehouseName.includes('alpha') ? 30 : 20 },
    { isbn: '978-0-14-028329-5', quantity: warehouseName.includes('alpha') ? 20 : 30 },
    { isbn: '978-0-14-243724-7', quantity: warehouseName.includes('alpha') ? 15 : 25 },
    { isbn: '978-0-452-28423-4', quantity: warehouseName.includes('alpha') ? 18 : 22 },
    { isbn: '978-0-06-093546-7', quantity: warehouseName.includes('alpha') ? 12 : 28 },
    { isbn: '978-0-06-112241-5', quantity: warehouseName.includes('alpha') ? 40 : 35 },
    { isbn: '978-0-547-92822-7', quantity: warehouseName.includes('alpha') ? 50 : 45 },
    { isbn: '978-0-553-21311-7', quantity: warehouseName.includes('alpha') ? 22 : 18 },
    { isbn: '978-0-385-49081-8', quantity: warehouseName.includes('alpha') ? 35 : 30 },
    { isbn: '978-1-59420-229-4', quantity: warehouseName.includes('alpha') ? 20 : 25 },
    { isbn: '978-0-385-35668-4', quantity: warehouseName.includes('alpha') ? 28 : 32 },
    { isbn: '978-0-06-231609-7', quantity: warehouseName.includes('alpha') ? 45 : 40 },
    { isbn: '978-0-316-76948-0', quantity: warehouseName.includes('alpha') ? 30 : 35 },
    { isbn: '978-0-670-81302-4', quantity: warehouseName.includes('alpha') ? 25 : 20 },
    { isbn: '978-1-59184-280-9', quantity: warehouseName.includes('alpha') ? 38 : 42 },
    { isbn: '978-0-06-085052-4', quantity: warehouseName.includes('alpha') ? 27 : 23 },
    { isbn: '978-0-14-118280-3', quantity: warehouseName.includes('alpha') ? 22 : 28 },
    { isbn: '978-0-307-58837-1', quantity: warehouseName.includes('alpha') ? 20 : 25 },
    { isbn: '978-1-5011-2701-8', quantity: warehouseName.includes('alpha') ? 33 : 37 },
  ];

  for (const item of inventoryData) {
    const existing = await inventoryRepo.findOne({ where: { isbn: item.isbn } });
    if (!existing) {
      const bookId = booksMap[item.isbn];
      if (!bookId) {
        console.log(`⚠️  Skipping ISBN ${item.isbn} - not found in Store`);
        continue;
      }

      const inventory = inventoryRepo.create({
        book_id: bookId,
        isbn: item.isbn,
        quantity: item.quantity,
      });
      await inventoryRepo.save(inventory);
      console.log(`✅ Created inventory: ISBN ${item.isbn} - Qty: ${item.quantity}`);
    }
  }

  console.log(`✅ Warehouse seeding completed: ${config.warehouse.name}`);
  await AppDataSource.destroy();
}

seedWarehouse().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});
