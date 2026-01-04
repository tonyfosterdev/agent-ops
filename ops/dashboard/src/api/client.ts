/**
 * API Client for AgentOps Dashboard.
 *
 * Handles communication with the agent server for:
 * - Thread management (create, list, get messages)
 * - Chat message sending
 * - Tool approval/rejection
 */

const API_BASE = '/api';

/**
 * Thread metadata returned by the server.
 */
export interface Thread {
  id: string;
  userId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Message content part types based on Inngest AgentKit message format.
 */
export type MessagePart =
  | { type: 'text'; content: string }
  | {
      type: 'tool-call';
      id: string;
      name: string;
      args: Record<string, unknown>;
      requiresApproval?: boolean;
      status?: 'pending' | 'approved' | 'rejected';
    }
  | {
      type: 'tool-result';
      toolCallId: string;
      result: unknown;
      isError?: boolean;
    };

/**
 * Chat message structure.
 */
export interface Message {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts?: MessagePart[];
  agentName?: string;
  createdAt: string;
}

/**
 * Pending tool approval from agent execution.
 */
export interface PendingApproval {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  agentName?: string;
}

/**
 * API Error class for consistent error handling.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Generic fetch wrapper with error handling.
 */
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(
      error.error || `Request failed: ${response.statusText}`,
      response.status,
      error.code
    );
  }

  return response.json();
}

/**
 * Create a new conversation thread.
 *
 * @param userId - User identifier for the thread owner
 * @param title - Optional title for the thread
 * @returns The created thread ID
 */
export async function createThread(
  userId: string,
  title?: string
): Promise<{ threadId: string }> {
  return apiFetch('/threads', {
    method: 'POST',
    body: JSON.stringify({ userId, title }),
  });
}

/**
 * List threads for a user.
 *
 * @param userId - User identifier
 * @param limit - Maximum number of threads to return
 * @returns Array of thread metadata
 */
export async function listThreads(
  userId: string,
  limit = 50
): Promise<{ threads: Thread[] }> {
  return apiFetch(`/threads/${encodeURIComponent(userId)}?limit=${limit}`);
}

/**
 * Get messages for a thread.
 *
 * @param threadId - Thread UUID
 * @param limit - Optional limit on number of messages
 * @returns Array of messages
 */
export async function getMessages(
  threadId: string,
  limit?: number
): Promise<{ messages: Message[] }> {
  const url = limit
    ? `/thread/${encodeURIComponent(threadId)}/messages?limit=${limit}`
    : `/thread/${encodeURIComponent(threadId)}/messages`;
  return apiFetch(url);
}

/**
 * Send a chat message to trigger agent processing.
 *
 * The message is sent as an Inngest event which triggers durable
 * agent execution. Poll for updates using getMessages().
 *
 * @param threadId - Thread UUID
 * @param message - User's message
 * @param userId - Optional user identifier
 * @returns Event IDs from Inngest
 */
export async function sendMessage(
  threadId: string,
  message: string,
  userId?: string
): Promise<{ ok: boolean; eventIds: string[] }> {
  return apiFetch('/chat', {
    method: 'POST',
    body: JSON.stringify({ threadId, message, userId }),
  });
}

/**
 * Send tool approval or rejection.
 *
 * Used to respond to HITL (Human-in-the-Loop) approval requests
 * for dangerous tool executions.
 *
 * @param runId - Inngest run ID for correlation
 * @param toolCallId - ID of the tool call
 * @param approved - Whether the tool execution is approved
 * @param feedback - Optional feedback message
 */
export async function submitApproval(
  runId: string,
  toolCallId: string,
  approved: boolean,
  feedback?: string
): Promise<{ ok: boolean }> {
  return apiFetch('/approve', {
    method: 'POST',
    body: JSON.stringify({ runId, toolCallId, approved, feedback }),
  });
}

/**
 * Health check for the agent server.
 */
export async function healthCheck(): Promise<{
  status: string;
  service: string;
  timestamp: string;
}> {
  return apiFetch('/health');
}
