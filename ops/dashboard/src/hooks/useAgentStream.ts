/**
 * useAgentStream Hook - Real-time streaming for agent events.
 *
 * This hook replaces the polling-based useChat with Inngest Realtime streaming.
 * It subscribes to agent events for a specific thread and processes them
 * to maintain chat state.
 *
 * ## Features
 * - Real-time event streaming via Inngest Realtime
 * - Automatic token refresh
 * - HITL approval state management
 * - Message accumulation from stream events
 *
 * ## Usage
 *
 * ```tsx
 * function Chat() {
 *   const {
 *     messages,
 *     isRunning,
 *     pendingApprovals,
 *     sendMessage,
 *     submitApproval,
 *   } = useAgentStream({ userId: 'user-123', threadId: 'thread-456' });
 *
 *   return (
 *     <div>
 *       {messages.map(msg => <Message key={msg.id} {...msg} />)}
 *       <ChatInput onSend={sendMessage} disabled={isRunning} />
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useInngestSubscription, type InngestSubscriptionState } from '@inngest/realtime/hooks';
import {
  createThread,
  getMessages,
  sendMessage as apiSendMessage,
  submitApproval as apiSubmitApproval,
  getRealtimeToken,
  type RealtimeToken,
} from '@/api/client';
import type {
  AgentStreamEvent,
  PendingApproval,
  StreamMessage,
  StreamMessagePart,
  StreamStatus,
} from './types';

export interface UseAgentStreamOptions {
  /** User identifier for thread ownership */
  userId: string;
  /** Existing thread ID to load, or create new if not provided */
  threadId?: string;
}

export interface UseAgentStreamReturn {
  /** Current thread ID */
  threadId: string | null;
  /** All messages in the current thread */
  messages: StreamMessage[];
  /** Whether an agent run is in progress */
  isRunning: boolean;
  /** Stream connection status */
  status: StreamStatus;
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
 * Process incoming stream events and update state.
 */
function processStreamEvent(
  event: AgentStreamEvent,
  setMessages: React.Dispatch<React.SetStateAction<StreamMessage[]>>,
  setPendingApprovals: React.Dispatch<React.SetStateAction<PendingApproval[]>>,
  setIsRunning: React.Dispatch<React.SetStateAction<boolean>>,
  currentRunIdRef: React.MutableRefObject<string | null>
): void {
  switch (event.type) {
    case 'run.started':
      currentRunIdRef.current = event.runId;
      setIsRunning(true);
      break;

    case 'tool.call':
      if (event.requiresApproval) {
        // Add to pending approvals
        setPendingApprovals((prev) => [
          ...prev.filter((a) => a.toolCallId !== event.toolCallId),
          {
            runId: currentRunIdRef.current || '',
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: (event.args as Record<string, unknown>) || {},
            reason: event.reason,
            agentName: event.agentName,
          },
        ]);
      }

      // Add tool call to messages as a part
      setMessages((prev) => {
        // Find or create assistant message for this tool call
        const lastMsg = prev[prev.length - 1];
        const toolCallPart: StreamMessagePart = {
          type: 'tool-call',
          id: event.toolCallId,
          name: event.toolName,
          args: (event.args as Record<string, unknown>) || {},
          requiresApproval: event.requiresApproval,
          status: event.requiresApproval ? 'pending' : 'completed',
          reason: event.reason,
        };

        if (lastMsg?.role === 'assistant' && lastMsg.runId === currentRunIdRef.current) {
          // Append to existing assistant message
          return [
            ...prev.slice(0, -1),
            {
              ...lastMsg,
              parts: [...(lastMsg.parts || []), toolCallPart],
            },
          ];
        } else {
          // Create new assistant message
          return [
            ...prev,
            {
              id: `stream-${Date.now()}-${event.toolCallId}`,
              threadId: '', // Will be set by parent
              role: 'assistant',
              content: '',
              parts: [toolCallPart],
              agentName: event.agentName,
              createdAt: new Date().toISOString(),
              runId: currentRunIdRef.current || undefined,
            },
          ];
        }
      });
      break;

    case 'tool.result':
      // Remove from pending approvals
      setPendingApprovals((prev) =>
        prev.filter((a) => a.toolCallId !== event.toolCallId)
      );

      // Update tool call status in messages
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.runId !== currentRunIdRef.current) return msg;
          if (!msg.parts) return msg;

          return {
            ...msg,
            parts: msg.parts.map((part) => {
              if (part.type === 'tool-call' && part.id === event.toolCallId) {
                return {
                  ...part,
                  status: event.isError ? 'rejected' : 'completed',
                } as StreamMessagePart;
              }
              return part;
            }),
          };
        })
      );

      // Add tool result as a part
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        const toolResultPart: StreamMessagePart = {
          type: 'tool-result',
          toolCallId: event.toolCallId,
          result: event.result,
          isError: event.isError,
          rejectionFeedback: event.rejectionFeedback,
        };

        if (lastMsg?.role === 'assistant' && lastMsg.runId === currentRunIdRef.current) {
          return [
            ...prev.slice(0, -1),
            {
              ...lastMsg,
              parts: [...(lastMsg.parts || []), toolResultPart],
            },
          ];
        } else {
          return [
            ...prev,
            {
              id: `stream-result-${Date.now()}-${event.toolCallId}`,
              threadId: '',
              role: 'assistant',
              content: '',
              parts: [toolResultPart],
              createdAt: new Date().toISOString(),
              runId: currentRunIdRef.current || undefined,
            },
          ];
        }
      });
      break;

    case 'run.complete':
      setIsRunning(false);
      currentRunIdRef.current = null;
      break;

    case 'run.error':
      setIsRunning(false);
      currentRunIdRef.current = null;
      // Error handling could add a system message here
      break;
  }
}

export function useAgentStream({
  userId,
  threadId: initialThreadId,
}: UseAgentStreamOptions): UseAgentStreamReturn {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId || null);
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<StreamStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [subscriptionToken, setSubscriptionToken] = useState<RealtimeToken | null>(null);

  const currentRunIdRef = useRef<string | null>(null);

  /**
   * Fetch subscription token for the current thread.
   */
  const fetchToken = useCallback(async (tid: string) => {
    try {
      const { token } = await getRealtimeToken(tid, userId);
      setSubscriptionToken(token);
      setStatus('connecting');
    } catch (err) {
      console.error('Failed to fetch subscription token:', err);
      setError('Failed to connect to stream');
      setStatus('error');
    }
  }, [userId]);

  /**
   * Subscribe to the agent stream using Inngest Realtime.
   *
   * The hook returns subscription state rather than using callbacks.
   * We use effects to process the data as it arrives.
   */
  const subscription = useInngestSubscription({
    // Cast token to the expected type - the structure matches Inngest's Token interface
    token: subscriptionToken as Parameters<typeof useInngestSubscription>[0]['token'],
    enabled: !!subscriptionToken && !!threadId,
  });

  /**
   * Map Inngest subscription state to our StreamStatus type.
   */
  const mapSubscriptionState = useCallback(
    (state: InngestSubscriptionState): StreamStatus => {
      switch (state) {
        case 'active':
          return isRunning ? 'running' : 'connected';
        case 'connecting':
        case 'refresh_token':
          return 'connecting';
        case 'error':
          return 'error';
        case 'closed':
        case 'closing':
        default:
          return 'disconnected';
      }
    },
    [isRunning]
  );

  // Update status based on subscription state
  useEffect(() => {
    setStatus(mapSubscriptionState(subscription.state));
  }, [subscription.state, mapSubscriptionState]);

  // Process subscription errors
  useEffect(() => {
    if (subscription.error) {
      console.error('Stream error:', subscription.error);
      setError('Stream connection error');
    }
  }, [subscription.error]);

  // Process new stream data
  useEffect(() => {
    if (subscription.freshData.length > 0) {
      for (const message of subscription.freshData) {
        // The Inngest realtime message contains a `data` field with our actual event
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const eventData = (message as any)?.data;
        if (eventData && typeof eventData === 'object' && 'type' in eventData) {
          processStreamEvent(
            eventData as AgentStreamEvent,
            setMessages,
            setPendingApprovals,
            setIsRunning,
            currentRunIdRef
          );
        }
      }
    }
  }, [subscription.freshData]);

  /**
   * Load messages from the server (for initial load and thread switches).
   */
  const loadMessages = useCallback(async (tid: string) => {
    try {
      const { messages: serverMessages } = await getMessages(tid);
      // Convert server messages to StreamMessage format
      const streamMessages: StreamMessage[] = serverMessages.map((msg) => ({
        id: msg.id,
        threadId: msg.threadId,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        parts: msg.parts as StreamMessagePart[] | undefined,
        agentName: msg.agentName,
        createdAt: msg.createdAt,
      }));
      setMessages(streamMessages);
    } catch (err) {
      console.error('Failed to load messages:', err);
      throw err;
    }
  }, []);

  /**
   * Create a new conversation thread.
   */
  const createNewThread = useCallback(
    async (title?: string): Promise<string> => {
      try {
        setError(null);
        setSubscriptionToken(null);
        const { threadId: newThreadId } = await createThread(userId, title);
        setThreadId(newThreadId);
        setMessages([]);
        setPendingApprovals([]);
        await fetchToken(newThreadId);
        return newThreadId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create thread';
        setError(message);
        throw err;
      }
    },
    [userId, fetchToken]
  );

  /**
   * Load an existing thread.
   */
  const loadThread = useCallback(
    async (tid: string): Promise<void> => {
      try {
        setError(null);
        setSubscriptionToken(null);
        setThreadId(tid);
        await loadMessages(tid);
        await fetchToken(tid);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load thread';
        setError(message);
        throw err;
      }
    },
    [loadMessages, fetchToken]
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

        // Optimistic update: add user message immediately
        const optimisticMessage: StreamMessage = {
          id: `temp-${Date.now()}`,
          threadId: currentThreadId,
          role: 'user',
          content: content.trim(),
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticMessage]);

        // Send message to server (triggers Inngest event)
        await apiSendMessage(currentThreadId, content.trim(), userId);

        // The stream subscription will receive run.started and subsequent events
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send message';
        setError(message);

        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => !m.id.startsWith('temp-')));
      }
    },
    [threadId, userId, createNewThread]
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
      if (!threadId) {
        setError('Cannot submit approval: no active thread');
        return;
      }

      try {
        setError(null);
        await apiSubmitApproval(runId, toolCallId, approved, threadId, userId, feedback);

        // Optimistically remove from pending approvals
        // The stream will confirm with tool.result event
        setPendingApprovals((prev) =>
          prev.filter((a) => a.toolCallId !== toolCallId)
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to submit approval';
        setError(message);
      }
    },
    [threadId, userId]
  );

  /**
   * Clear error state.
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Initialize subscription when thread changes
  useEffect(() => {
    if (initialThreadId && initialThreadId !== threadId) {
      loadThread(initialThreadId);
    } else if (threadId && !subscriptionToken) {
      fetchToken(threadId);
    }
  }, [initialThreadId, threadId, subscriptionToken, loadThread, fetchToken]);

  // Update status based on running state
  useEffect(() => {
    if (isRunning && status === 'connected') {
      setStatus('running');
    } else if (!isRunning && status === 'running') {
      setStatus('connected');
    }
  }, [isRunning, status]);

  return {
    threadId,
    messages,
    isRunning,
    status,
    error,
    pendingApprovals,
    sendMessage,
    submitApproval,
    clearError,
    createNewThread,
    loadThread,
  };
}
