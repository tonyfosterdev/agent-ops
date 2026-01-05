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

/**
 * Ensure database schema exists.
 *
 * Runs the schema SQL which uses IF NOT EXISTS, making it idempotent.
 * Safe to call on every startup - won't modify existing tables.
 */
export async function ensureSchema(): Promise<void> {
  try {
    // Create tables if they don't exist
    await sql`
      CREATE TABLE IF NOT EXISTS agent_threads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        title TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id UUID NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
        message_type TEXT NOT NULL CHECK (message_type IN ('user', 'agent', 'tool')),
        agent_name TEXT,
        role TEXT NOT NULL,
        content JSONB NOT NULL,
        checksum TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (thread_id, checksum)
      )
    `;

    // Create indexes if they don't exist
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_thread ON agent_messages(thread_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_created ON agent_messages(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_threads_user ON agent_threads(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_threads_updated ON agent_threads(updated_at)`;

    // Create or replace the trigger function
    await sql`
      CREATE OR REPLACE FUNCTION update_thread_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE agent_threads SET updated_at = NOW() WHERE id = NEW.thread_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    // Drop and recreate trigger (idempotent)
    await sql`DROP TRIGGER IF EXISTS trigger_update_thread_timestamp ON agent_messages`;
    await sql`
      CREATE TRIGGER trigger_update_thread_timestamp
        AFTER INSERT ON agent_messages
        FOR EACH ROW
        EXECUTE FUNCTION update_thread_timestamp()
    `;

    console.log('Database schema verified/created successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to ensure database schema: ${message}`);
  }
}
