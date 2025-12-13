import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config, logger } from './config.js';
import { Session } from './entities/Session.js';
import { AgentRun } from './entities/AgentRun.js';
import { JournalEntry } from './entities/JournalEntry.js';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: config.nodeEnv === 'development',
  logging: config.nodeEnv === 'development',
  entities: [Session, AgentRun, JournalEntry],
});

export async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize();
    logger.info({ database: config.db.database, host: config.db.host }, 'Ops database connection established');
  } catch (error) {
    logger.error({ error }, 'Error connecting to ops database');
    throw error;
  }
}
