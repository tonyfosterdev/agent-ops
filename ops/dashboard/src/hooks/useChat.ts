/**
 * useChat Hook - Manages chat state and server communication.
 *
 * This hook provides:
 * - Thread management (create, select)
 * - Message sending with optimistic updates
 * - Polling for agent responses
 * - Tool approval handling
 *
 * ## Usage
 *
 * ```tsx
 * function Chat() {
 *   const {
 *     messages,
 *     isLoading,
 *     sendMessage,
 *     pendingApprovals,
 *     submitApproval,
 *   } = useChat({ userId: 'user-123' });
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <Message key={msg.id} {...msg} />)}
 *       <ChatInput onSend={sendMessage} disabled={isLoading} />
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Message,
  PendingApproval,
  createThread,
  getMessages,
  sendMessage as apiSendMessage,
  submitApproval as apiSubmitApproval,
} from '@/api/client';

export interface UseChatOptions {
  /** User identifier for thread ownership */
  userId: string;
  /** Existing thread ID to load, or create new if not provided */
  threadId?: string;
  /** Polling interval in ms when waiting for agent response (default: 2000) */
  pollInterval?: number;
}

export interface UseChatReturn {
  /** Current thread ID */
  threadId: string | null;
  /** All messages in the current thread */
  messages: Message[];
  /** Whether we're waiting for agent response */
  isLoading: boolean;
  /** Error message if something went wrong */
  error: string | null;
  /** Tool calls waiting for user approval */
  pendingApprovals: PendingApproval[];
  /** Send a new message */
  sendMessage: (content: string) => Promise<void>;
  /** Submit approval/rejection for a tool call */
  submitApproval: (
    runId: string,
    toolCallId: string,
    approved: boolean,
    feedback?: string
  ) => Promise<void>;
  /** Clear error state */
  clearError: () => void;
  /** Create a new thread */
  createNewThread: (title?: string) => Promise<string>;
  /** Load an existing thread */
  loadThread: (threadId: string) => Promise<void>;
}

/**
 * Extract pending approvals from messages.
 *
 * Looks for tool-call parts with requiresApproval=true and status=pending.
 */
function extractPendingApprovals(messages: Message[]): PendingApproval[] {
  const approvals: PendingApproval[] = [];

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.parts) continue;

    for (const part of msg.parts) {
      if (
        part.type === 'tool-call' &&
        part.requiresApproval &&
        part.status === 'pending'
      ) {
        approvals.push({
          // The runId should be embedded in the message metadata
          // For now, use message ID as a fallback - server will need to provide this
          runId: (msg as Message & { runId?: string }).runId || msg.id,
          toolCallId: part.id,
          toolName: part.name,
          args: part.args,
          agentName: msg.agentName,
        });
      }
    }
  }

  return approvals;
}

export function useChat({
  userId,
  threadId: initialThreadId,
  pollInterval = 2000,
}: UseChatOptions): UseChatReturn {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  // Polling control
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldPollRef = useRef(false);

  /**
   * Fetch messages from the server and update state.
   */
  const fetchMessages = useCallback(async (tid: string) => {
    try {
      const { messages: serverMessages } = await getMessages(tid);
      setMessages(serverMessages);

      // Extract any pending approvals
      const approvals = extractPendingApprovals(serverMessages);
      setPendingApprovals(approvals);

      return serverMessages;
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      throw err;
    }
  }, []);

  /**
   * Start polling for message updates.
   */
  const startPolling = useCallback(
    (tid: string) => {
      shouldPollRef.current = true;

      const poll = async () => {
        if (!shouldPollRef.current) return;

        try {
          const msgs = await fetchMessages(tid);

          // Check if agent is still processing (last message from assistant without tool results pending)
          const lastMsg = msgs[msgs.length - 1];
          const hasApprovals = extractPendingApprovals(msgs).length > 0;

          // Continue polling if:
          // 1. Last message is from user (agent hasn't responded yet)
          // 2. There are pending approvals (waiting for user action)
          // 3. Agent is in the middle of processing (we'd need more metadata to know this)
          const shouldContinue =
            lastMsg?.role === 'user' || hasApprovals;

          if (shouldContinue && shouldPollRef.current) {
            pollTimeoutRef.current = setTimeout(poll, pollInterval);
          } else {
            setIsLoading(false);
          }
        } catch (err) {
          console.error('Polling error:', err);
          setIsLoading(false);
        }
      };

      poll();
    },
    [fetchMessages, pollInterval]
  );

  /**
   * Stop polling for updates.
   */
  const stopPolling = useCallback(() => {
    shouldPollRef.current = false;
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  /**
   * Create a new conversation thread.
   */
  const createNewThread = useCallback(
    async (title?: string): Promise<string> => {
      try {
        stopPolling();
        setError(null);
        const { threadId: newThreadId } = await createThread(userId, title);
        setThreadId(newThreadId);
        setMessages([]);
        setPendingApprovals([]);
        return newThreadId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create thread';
        setError(message);
        throw err;
      }
    },
    [userId, stopPolling]
  );

  /**
   * Load an existing thread.
   */
  const loadThread = useCallback(
    async (tid: string): Promise<void> => {
      try {
        stopPolling();
        setError(null);
        setThreadId(tid);
        await fetchMessages(tid);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load thread';
        setError(message);
        throw err;
      }
    },
    [fetchMessages, stopPolling]
  );

  /**
   * Send a new message to the agent.
   */
  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      if (!content.trim()) return;

      let currentThreadId = threadId;

      // Create thread if needed
      if (!currentThreadId) {
        currentThreadId = await createNewThread();
      }

      try {
        setError(null);
        setIsLoading(true);

        // Optimistic update: add user message immediately
        const optimisticMessage: Message = {
          id: `temp-${Date.now()}`,
          threadId: currentThreadId,
          role: 'user',
          content: content.trim(),
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticMessage]);

        // Send message to server (triggers Inngest event)
        await apiSendMessage(currentThreadId, content.trim(), userId);

        // Start polling for agent response
        startPolling(currentThreadId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message';
        setError(message);
        setIsLoading(false);

        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => !m.id.startsWith('temp-')));
      }
    },
    [threadId, userId, createNewThread, startPolling]
  );

  /**
   * Submit approval or rejection for a tool call.
   */
  const submitApproval = useCallback(
    async (
      runId: string,
      toolCallId: string,
      approved: boolean,
      feedback?: string
    ): Promise<void> => {
      if (!threadId) return;

      try {
        setError(null);

        await apiSubmitApproval(runId, toolCallId, approved, feedback);

        // Remove from pending approvals optimistically
        setPendingApprovals((prev) =>
          prev.filter((a) => a.toolCallId !== toolCallId)
        );

        // Start polling to get the result
        setIsLoading(true);
        startPolling(threadId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to submit approval';
        setError(message);
      }
    },
    [threadId, startPolling]
  );

  /**
   * Clear error state.
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Load initial thread if provided
  useEffect(() => {
    if (initialThreadId && initialThreadId !== threadId) {
      loadThread(initialThreadId);
    }
  }, [initialThreadId, threadId, loadThread]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    threadId,
    messages,
    isLoading,
    error,
    pendingApprovals,
    sendMessage,
    submitApproval,
    clearError,
    createNewThread,
    loadThread,
  };
}
