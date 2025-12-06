import { DataSource } from 'typeorm';
import { config } from './config';
import { User } from './entities/User';
import { Inventory } from './entities/Inventory';
import { ShipmentLog } from './entities/ShipmentLog';
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
  entities: [User, Inventory, ShipmentLog],
  migrations: ['src/migrations/*.ts'],
  subscribers: [],
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    logger.info({ warehouse: config.warehouse.name, database: config.db.database }, 'Warehouse database connection established');
  } catch (error) {
    logger.error({ warehouse: config.warehouse.name, error, database: config.db.database }, 'Error connecting to warehouse database');
    process.exit(1);
  }
}
