/**
 * Chat Component - Main chat interface for AgentOps dashboard.
 *
 * This is the primary user interface for interacting with agents.
 * It combines message display, input handling, and HITL approvals.
 *
 * ## Features
 * - Message history display with auto-scroll
 * - Input field with send button
 * - Loading indicator during agent processing
 * - Error display with dismiss
 * - Tool approval integration
 *
 * ## Usage
 *
 * ```tsx
 * <Chat userId="user-123" />
 * ```
 */

import { useState, useRef, KeyboardEvent, FormEvent } from 'react';
import { useChat } from '@/hooks/useChat';
import { MessageList } from './MessageList';

export interface ChatProps {
  /** User identifier for thread ownership */
  userId: string;
  /** Existing thread ID to load */
  threadId?: string;
}

/**
 * Chat input component with textarea and send button.
 */
function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled: boolean;
}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInput = () => {
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t bg-white p-4">
      <div className="flex gap-2 items-end max-w-4xl mx-auto">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-xl border border-gray-300 px-4 py-3 pr-12 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl px-4 py-3 transition-colors flex items-center justify-center"
        >
          {disabled ? (
            <svg
              className="animate-spin h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          )}
        </button>
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">
        Press Enter to send, Shift+Enter for new line
      </p>
    </form>
  );
}

/**
 * Error banner component.
 */
function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="bg-red-50 border-b border-red-200 px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-700">
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-sm">{message}</span>
        </div>
        <button
          onClick={onDismiss}
          className="text-red-500 hover:text-red-700"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Chat header component.
 */
function ChatHeader({
  threadId,
  onNewThread,
}: {
  threadId: string | null;
  onNewThread: () => void;
}) {
  return (
    <header className="bg-white border-b px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900">AgentOps</h1>
            <p className="text-xs text-gray-500">
              {threadId ? `Thread: ${threadId.slice(0, 8)}...` : 'New conversation'}
            </p>
          </div>
        </div>
        <button
          onClick={onNewThread}
          className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          New Chat
        </button>
      </div>
    </header>
  );
}

export function Chat({ userId, threadId: initialThreadId }: ChatProps) {
  const {
    threadId,
    messages,
    isLoading,
    error,
    pendingApprovals,
    sendMessage,
    submitApproval,
    clearError,
    createNewThread,
  } = useChat({ userId, threadId: initialThreadId });

  const handleApprove = (runId: string, toolCallId: string) => {
    submitApproval(runId, toolCallId, true);
  };

  const handleDeny = (runId: string, toolCallId: string, reason: string) => {
    submitApproval(runId, toolCallId, false, reason);
  };

  const handleNewThread = async () => {
    try {
      await createNewThread();
    } catch {
      // Error is handled in the hook
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <ChatHeader threadId={threadId} onNewThread={handleNewThread} />

      {error && <ErrorBanner message={error} onDismiss={clearError} />}

      <div className="flex-1 overflow-hidden max-w-4xl w-full mx-auto">
        <MessageList
          messages={messages}
          isLoading={isLoading}
          pendingApprovals={pendingApprovals}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      </div>

      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
