/**
 * Jest Test Setup
 *
 * This file runs before all tests and configures:
 * - Test environment variables
 * - Database connection
 * - Cleanup hooks
 */

import 'reflect-metadata';

// Set test environment variables BEFORE importing anything else
process.env.NODE_ENV = 'test';
process.env.OPS_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
process.env.OPS_DB_PORT = process.env.TEST_DB_PORT || '5436';
process.env.OPS_DB_USERNAME = process.env.TEST_DB_USERNAME || 'testuser';
process.env.OPS_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'testpass';
process.env.OPS_DB_DATABASE = process.env.TEST_DB_DATABASE || 'test_ops_db';
process.env.AUTH_USERNAME = 'testadmin';
process.env.AUTH_PASSWORD = 'testpass';
process.env.LOG_LEVEL = 'silent'; // Suppress logs during tests

// Import AppDataSource AFTER setting env vars so it picks up test config
import { AppDataSource } from '../database.js';
import { Session } from '../entities/Session.js';
import { AgentRun } from '../entities/AgentRun.js';
import { JournalEntry } from '../entities/JournalEntry.js';

// Re-export for tests that need direct access
export { AppDataSource as TestDataSource };

/**
 * Initialize test database connection
 */
export async function initTestDatabase(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

/**
 * Clean all tables (delete all data)
 */
export async function cleanDatabase(): Promise<void> {
  if (!AppDataSource.isInitialized) return;

  // Use query builder to handle empty tables gracefully
  await AppDataSource.getRepository(JournalEntry)
    .createQueryBuilder()
    .delete()
    .from(JournalEntry)
    .execute();

  await AppDataSource.getRepository(AgentRun)
    .createQueryBuilder()
    .delete()
    .from(AgentRun)
    .execute();

  await AppDataSource.getRepository(Session)
    .createQueryBuilder()
    .delete()
    .from(Session)
    .execute();
}

/**
 * Close test database connection
 */
export async function closeTestDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

// Global Jest hooks
beforeAll(async () => {
  await initTestDatabase();
});

afterEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
});

// Export test credentials for use in tests
export const TEST_AUTH = {
  username: 'testadmin',
  password: 'testpass',
};
