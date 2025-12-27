import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config, logger } from './config';
import { Run } from './entities/Run';
import { JournalEntry } from './entities/JournalEntry';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: true, // Auto-create tables
  logging: config.nodeEnv === 'development',
  entities: [Run, JournalEntry],
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    logger.info(
      { database: config.db.database, host: config.db.host },
      'Ops database connected'
    );
  } catch (error) {
    logger.error({ error }, 'Database connection failed');
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
    logger.info('Database connection closed');
  }
}
