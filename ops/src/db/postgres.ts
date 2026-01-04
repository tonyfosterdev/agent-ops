/**
 * PostgreSQL connection for agent database.
 *
 * Uses the `postgres` package for connection pooling and query execution.
 * Connects to a dedicated agent database, separate from application databases.
 */

import postgres from 'postgres';
import { config } from '../config.js';

/**
 * Column name transformer for converting snake_case to camelCase.
 */
function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * PostgreSQL connection instance.
 *
 * Uses connection URL from configuration with sensible defaults for:
 * - Connection pooling (max 10 connections)
 * - Idle timeout (20 seconds)
 * - Connection timeout (10 seconds)
 */
export const sql = postgres(config.database.url, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Transform column names to camelCase for JavaScript convention
  transform: {
    column: toCamelCase,
  },
});

/**
 * Test database connectivity.
 *
 * Call this at startup to fail fast if the database is unreachable.
 * Returns true if connection succeeds, throws on failure.
 */
export async function testConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1 as connected`;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Database connection failed: ${message}`);
  }
}

/**
 * Gracefully close database connections.
 *
 * Call this during application shutdown to ensure clean connection release.
 */
export async function closeConnection(): Promise<void> {
  await sql.end();
}
