/**
 * Database module exports.
 *
 * Provides PostgreSQL connection and history adapter for
 * AgentKit conversation persistence.
 */

export { sql, testConnection, closeConnection } from './postgres.js';
export {
  historyAdapter,
  type MessageRole,
  type MessageType,
  type HistoryMessage,
  type StoredMessage,
  type Thread,
} from './history-adapter.js';
