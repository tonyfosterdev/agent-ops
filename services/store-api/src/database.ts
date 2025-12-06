import { DataSource } from 'typeorm';
import { config } from './config';
import { User } from './entities/User';
import { Book } from './entities/Book';
import { InventoryCache } from './entities/InventoryCache';
import { Order } from './entities/Order';
import { OrderItem } from './entities/OrderItem';
import { Payment } from './entities/Payment';
import { WarehouseRegistry } from './entities/WarehouseRegistry';
import { logger } from './logger';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: config.nodeEnv === 'development', // Auto-sync in dev, use migrations in prod
  logging: config.nodeEnv === 'development',
  entities: [User, Book, InventoryCache, Order, OrderItem, Payment, WarehouseRegistry],
  migrations: ['src/migrations/*.ts'],
  subscribers: [],
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    logger.info({ database: config.db.database }, 'Store database connection established');
  } catch (error) {
    logger.error({ error, database: config.db.database }, 'Error connecting to store database');
    process.exit(1);
  }
}
