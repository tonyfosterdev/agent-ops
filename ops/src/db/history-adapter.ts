/**
 * History adapter for AgentKit conversation persistence.
 *
 * Provides methods for creating threads, retrieving message history,
 * and appending new messages. Follows the AgentKit starter kit pattern.
 *
 * ## AgentKit Integration Contract
 *
 * This adapter is used by the AgentKit network to persist conversation history.
 * Integration happens in `network.ts` via the `history` option on `createNetwork()`:
 *
 * ```typescript
 * import { historyAdapter } from './db/index.js';
 *
 * export const agentNetwork = createNetwork({
 *   name: 'ops-network',
 *   agents: [codingAgent, logAnalyzer],
 *   defaultModel: anthropic({ model: 'claude-sonnet-4-20250514' }),
 *
 *   // Wire up the history adapter
 *   history: {
 *     get: (threadId) => historyAdapter.get(threadId),
 *     append: (threadId, messages) => historyAdapter.appendResults(threadId, messages),
 *   },
 * });
 * ```
 *
 * ## Message Format
 *
 * AgentKit provides messages with:
 * - `role`: 'user' | 'assistant' | 'system' | 'tool'
 * - `content`: varies by role (string for text, object for tool calls/results)
 *
 * This adapter stores content as JSONB, preserving the exact structure AgentKit
 * provides. The `message_type` and `agent_name` fields are extensions for
 * multi-agent attribution and dashboard UI categorization.
 *
 * ## Deduplication
 *
 * Messages are deduplicated by SHA-256 checksum of (role + content). This prevents
 * duplicate inserts when Inngest retries a step after a transient failure. The
 * checksum is truncated to 32 hex chars (128 bits) which is sufficient for the
 * expected message volume.
 */

import { createHash } from 'node:crypto';
import { sql } from './postgres.js';

/**
 * Message role types following AgentKit conventions.
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Message type for categorization.
 */
export type MessageType = 'user' | 'agent' | 'tool';

/**
 * Message structure for history operations.
 */
export interface HistoryMessage {
  role: MessageRole;
  content: unknown;
  agentName?: string;
}

/**
 * Stored message with metadata from database.
 */
export interface StoredMessage {
  id: string;
  threadId: string;
  messageType: MessageType;
  agentName: string | null;
  role: string;
  content: unknown;
  createdAt: Date;
}

/**
 * Thread metadata from database.
 */
export interface Thread {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Compute a checksum for message content to enable deduplication.
 */
function computeChecksum(role: string, content: unknown): string {
  const data = JSON.stringify({ role, content });
  return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
 * Determine message type based on role and agent attribution.
 */
function getMessageType(role: MessageRole, agentName?: string): MessageType {
  if (role === 'user') return 'user';
  if (role === 'tool') return 'tool';
  return 'agent';
}

/**
 * History adapter for conversation persistence.
 *
 * Provides CRUD operations for threads and messages following
 * the AgentKit starter kit patterns.
 */
export const historyAdapter = {
  /**
   * Create a new conversation thread.
   *
   * @param userId - Identifier for the user owning the thread
   * @param title - Optional title for the thread
   * @returns The UUID of the created thread
   */
  async createThread(userId: string, title?: string): Promise<string> {
    const result = await sql`
      INSERT INTO agent_threads (user_id, title)
      VALUES (${userId}, ${title ?? null})
      RETURNING id
    `;
    return result[0].id;
  },

  /**
   * Get thread metadata by ID.
   *
   * @param threadId - UUID of the thread
   * @returns Thread metadata or null if not found
   */
  async getThread(threadId: string): Promise<Thread | null> {
    const result = await sql<Thread[]>`
      SELECT id, user_id, title, created_at, updated_at
      FROM agent_threads
      WHERE id = ${threadId}
    `;
    return result[0] ?? null;
  },

  /**
   * List threads for a user, ordered by most recent activity.
   *
   * @param userId - Identifier for the user
   * @param limit - Maximum number of threads to return (default 50)
   * @returns Array of thread metadata
   */
  async listThreads(userId: string, limit = 50): Promise<Thread[]> {
    return sql<Thread[]>`
      SELECT id, user_id, title, created_at, updated_at
      FROM agent_threads
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Update thread title.
   *
   * @param threadId - UUID of the thread
   * @param title - New title for the thread
   */
  async updateThreadTitle(threadId: string, title: string): Promise<void> {
    await sql`
      UPDATE agent_threads
      SET title = ${title}, updated_at = NOW()
      WHERE id = ${threadId}
    `;
  },

  /**
   * Delete a thread and all its messages.
   *
   * @param threadId - UUID of the thread to delete
   */
  async deleteThread(threadId: string): Promise<void> {
    await sql`
      DELETE FROM agent_threads
      WHERE id = ${threadId}
    `;
  },

  /**
   * Retrieve message history for a thread.
   *
   * Messages are returned in chronological order (oldest first).
   *
   * @param threadId - UUID of the thread
   * @returns Array of stored messages
   */
  async get(threadId: string): Promise<StoredMessage[]> {
    const messages = await sql<StoredMessage[]>`
      SELECT id, thread_id, message_type, agent_name, role, content, created_at
      FROM agent_messages
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC
    `;
    return messages;
  },

  /**
   * Append messages to a thread's history.
   *
   * Uses checksums to prevent duplicate message insertion.
   * Messages with matching thread_id + checksum are silently skipped.
   *
   * @param threadId - UUID of the thread
   * @param messages - Array of messages to append
   */
  async appendResults(threadId: string, messages: HistoryMessage[]): Promise<void> {
    if (messages.length === 0) return;

    // Insert messages one by one with conflict handling for deduplication
    for (const msg of messages) {
      const messageType = getMessageType(msg.role, msg.agentName);
      const checksum = computeChecksum(msg.role, msg.content);

      await sql`
        INSERT INTO agent_messages (thread_id, message_type, agent_name, role, content, checksum)
        VALUES (
          ${threadId},
          ${messageType},
          ${msg.agentName ?? null},
          ${msg.role},
          ${JSON.stringify(msg.content)},
          ${checksum}
        )
        ON CONFLICT (thread_id, checksum) DO NOTHING
      `;
    }
  },

  /**
   * Append a single message to a thread.
   *
   * Convenience method for adding one message at a time.
   *
   * @param threadId - UUID of the thread
   * @param role - Message role (user, assistant, system, tool)
   * @param content - Message content (can be any JSON-serializable value)
   * @param agentName - Optional agent name for attribution
   * @returns The UUID of the created message, or null if deduplicated
   */
  async appendMessage(
    threadId: string,
    role: MessageRole,
    content: unknown,
    agentName?: string
  ): Promise<string | null> {
    const messageType = getMessageType(role, agentName);
    const checksum = computeChecksum(role, content);

    const result = await sql`
      INSERT INTO agent_messages (thread_id, message_type, agent_name, role, content, checksum)
      VALUES (
        ${threadId},
        ${messageType},
        ${agentName ?? null},
        ${role},
        ${JSON.stringify(content)},
        ${checksum}
      )
      ON CONFLICT (thread_id, checksum) DO NOTHING
      RETURNING id
    `;

    return result[0]?.id ?? null;
  },

  /**
   * Get the most recent messages from a thread.
   *
   * Useful for providing context window to agents.
   *
   * @param threadId - UUID of the thread
   * @param limit - Maximum number of messages to return
   * @returns Array of messages in chronological order
   */
  async getRecentMessages(threadId: string, limit: number): Promise<StoredMessage[]> {
    // Get last N messages, but return them in chronological order
    const messages = await sql<StoredMessage[]>`
      SELECT id, thread_id, message_type, agent_name, role, content, created_at
      FROM (
        SELECT id, thread_id, message_type, agent_name, role, content, created_at
        FROM agent_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      ) recent
      ORDER BY created_at ASC
    `;
    return messages;
  },
};
