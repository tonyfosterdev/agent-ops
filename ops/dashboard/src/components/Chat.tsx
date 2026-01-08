/**
 * Chat Component - Main chat interface for AgentOps dashboard.
 *
 * This is the primary user interface for interacting with agents.
 * It combines message display, input handling, and HITL approvals.
 *
 * ## Features
 * - Real-time streaming via @inngest/use-agent
 * - Message history display with auto-scroll
 * - Input field with send button
 * - Loading indicator during agent processing
 * - Error display with dismiss
 * - Tool approval integration via approveToolCall/denyToolCall
 */

import { useState, useRef, KeyboardEvent, FormEvent } from 'react';
import { useAgents, type AgentStatus } from '@inngest/use-agent';
import { MessageList } from './MessageList';
import { useTheme } from '@/App';

/**
 * Chat input component with textarea and send button.
 */
function ChatInput({
  onSend,
  disabled,
  placeholder = 'Type a message... (Enter to send, Shift+Enter for new line)',
}: {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
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
    <form onSubmit={handleSubmit} className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex gap-2 items-end max-w-4xl mx-auto">
        <div className="flex flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 px-4 py-3 focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800 focus:outline-none disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-500 dark:disabled:text-gray-500"
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 dark:disabled:bg-indigo-800 text-white rounded-xl w-12 h-12 transition-colors flex items-center justify-center"
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
      <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-2">
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
    <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-4 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
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
          className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
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
 * Get status indicator color based on agent status.
 * AgentStatus is: "ready" | "submitted" | "streaming" | "error"
 */
function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case 'ready':
      return 'bg-green-500';
    case 'submitted':
    case 'streaming':
      return 'bg-yellow-500 animate-pulse';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

/**
 * Get status text based on agent status.
 */
function getStatusText(status: AgentStatus): string {
  switch (status) {
    case 'ready':
      return 'Connected';
    case 'submitted':
      return 'Submitted...';
    case 'streaming':
      return 'Processing...';
    case 'error':
      return 'Error';
    default:
      return 'Disconnected';
  }
}

/**
 * Theme toggle button component.
 */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

/**
 * Chat header component.
 */
function ChatHeader({
  status,
  onNewThread,
}: {
  status: AgentStatus;
  onNewThread: () => void;
}) {
  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
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
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">AgentOps</h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(status)}`} />
                <span className="text-xs text-gray-400 dark:text-gray-500">{getStatusText(status)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={onNewThread}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium flex items-center gap-1"
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
      </div>
    </header>
  );
}

export function Chat() {
  const {
    messages,
    status,
    sendMessage,
    approveToolCall,
    denyToolCall,
    error,
    clearError,
  } = useAgents({ debug: true });

  // Status is: "ready" | "submitted" | "streaming" | "error"
  const isProcessing = status === 'submitted' || status === 'streaming';

  // Check if any messages have pending HITL parts
  const hasPendingApproval = messages.some((msg) =>
    msg.parts?.some(
      (part) => part.type === 'hitl' && (part as { status?: string }).status === 'pending'
    )
  );

  const handleApprove = (toolCallId: string) => {
    approveToolCall(toolCallId);
  };

  const handleDeny = (toolCallId: string, reason: string) => {
    denyToolCall(toolCallId, reason);
  };

  const handleNewThread = () => {
    // Navigate to create a new thread or clear current conversation
    // The useAgents hook may not have clearMessages - depends on implementation
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      <ChatHeader status={status} onNewThread={handleNewThread} />

      {error && <ErrorBanner message={error.message} onDismiss={clearError} />}

      <div className="flex-1 flex flex-col overflow-hidden max-w-4xl w-full mx-auto">
        <MessageList
          messages={messages as any}
          isLoading={isProcessing}
          isWaitingForApproval={hasPendingApproval}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      </div>

      <ChatInput
        onSend={sendMessage}
        disabled={isProcessing}
        placeholder={
          hasPendingApproval
            ? 'Waiting for your approval above...'
            : 'Type a message... (Enter to send, Shift+Enter for new line)'
        }
      />
    </div>
  );
}
