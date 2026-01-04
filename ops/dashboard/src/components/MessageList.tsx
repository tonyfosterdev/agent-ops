/**
 * MessageList Component - Renders chat messages with proper formatting.
 *
 * Handles different message types:
 * - User messages (right-aligned, blue)
 * - Assistant messages (left-aligned, gray)
 * - System messages (centered, muted)
 * - Tool calls and results within messages
 *
 * ## Features
 * - Auto-scroll to bottom on new messages
 * - Markdown-like code block rendering
 * - Tool call visualization
 * - Typing indicator during loading
 */

import { useEffect, useRef } from 'react';
import { Message, MessagePart, PendingApproval } from '@/api/client';
import { ToolApproval } from './ToolApproval';

export interface MessageListProps {
  /** Messages to display */
  messages: Message[];
  /** Whether agent is currently processing */
  isLoading: boolean;
  /** Pending tool approvals */
  pendingApprovals: PendingApproval[];
  /** Callback for tool approval */
  onApprove: (runId: string, toolCallId: string) => void;
  /** Callback for tool rejection */
  onDeny: (runId: string, toolCallId: string, reason: string) => void;
}

/**
 * Render a text part with basic markdown support.
 */
function TextPart({ content }: { content: string }) {
  // Simple code block detection
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          // Extract language and code
          const match = part.match(/```(\w*)\n?([\s\S]*?)```/);
          if (match) {
            const [, language, code] = match;
            return (
              <div key={i} className="my-2">
                {language && (
                  <div className="bg-gray-800 text-gray-400 text-xs px-3 py-1 rounded-t-lg">
                    {language}
                  </div>
                )}
                <pre
                  className={`bg-gray-900 text-gray-100 p-3 overflow-x-auto font-mono text-sm ${
                    language ? 'rounded-b-lg' : 'rounded-lg'
                  }`}
                >
                  <code>{code.trim()}</code>
                </pre>
              </div>
            );
          }
        }

        // Handle inline code
        const inlineCodeParts = part.split(/(`[^`]+`)/g);
        return (
          <span key={i}>
            {inlineCodeParts.map((codePart, j) => {
              if (codePart.startsWith('`') && codePart.endsWith('`')) {
                return (
                  <code
                    key={j}
                    className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono"
                  >
                    {codePart.slice(1, -1)}
                  </code>
                );
              }
              // Preserve newlines
              return codePart.split('\n').map((line, k, arr) => (
                <span key={`${j}-${k}`}>
                  {line}
                  {k < arr.length - 1 && <br />}
                </span>
              ));
            })}
          </span>
        );
      })}
    </>
  );
}

/**
 * Render a tool call part.
 */
function ToolCallPart({
  part,
  pendingApproval,
  onApprove,
  onDeny,
}: {
  part: Extract<MessagePart, { type: 'tool-call' }>;
  pendingApproval?: PendingApproval;
  onApprove: (runId: string, toolCallId: string) => void;
  onDeny: (runId: string, toolCallId: string, reason: string) => void;
}) {
  // If this tool call requires approval and is pending, show approval UI
  if (pendingApproval) {
    return (
      <ToolApproval
        tool={{ id: part.id, name: part.name, args: part.args }}
        runId={pendingApproval.runId}
        agentName={pendingApproval.agentName}
        onApprove={() => onApprove(pendingApproval.runId, part.id)}
        onDeny={(reason) => onDeny(pendingApproval.runId, part.id, reason)}
      />
    );
  }

  // Otherwise show a completed or non-approval tool call
  const statusColors = {
    pending: 'bg-yellow-50 border-yellow-200',
    approved: 'bg-green-50 border-green-200',
    rejected: 'bg-red-50 border-red-200',
  };

  const status = part.status || 'approved';
  const colors = statusColors[status];

  return (
    <div className={`${colors} border rounded-lg p-3 my-2 text-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <svg
          className="w-4 h-4 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <span className="font-mono font-medium">{part.name}</span>
        {status !== 'approved' && (
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              status === 'pending' ? 'bg-yellow-200 text-yellow-800' : 'bg-red-200 text-red-800'
            }`}
          >
            {status}
          </span>
        )}
      </div>
      <pre className="bg-gray-100 rounded p-2 overflow-x-auto text-xs font-mono">
        {JSON.stringify(part.args, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Render a tool result part.
 */
function ToolResultPart({
  part,
}: {
  part: Extract<MessagePart, { type: 'tool-result' }>;
}) {
  const isError = part.isError;

  return (
    <div
      className={`${
        isError ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
      } border rounded-lg p-3 my-2 text-sm`}
    >
      <div className="flex items-center gap-2 mb-2">
        {isError ? (
          <svg
            className="w-4 h-4 text-red-500"
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
        ) : (
          <svg
            className="w-4 h-4 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
        <span className="font-medium">{isError ? 'Error' : 'Result'}</span>
      </div>
      <pre className="bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto text-xs font-mono">
        {typeof part.result === 'string'
          ? part.result
          : JSON.stringify(part.result, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Single message component.
 */
function MessageItem({
  message,
  pendingApprovals,
  onApprove,
  onDeny,
}: {
  message: Message;
  pendingApprovals: PendingApproval[];
  onApprove: (runId: string, toolCallId: string) => void;
  onDeny: (runId: string, toolCallId: string, reason: string) => void;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-4">
        <div className="bg-gray-100 text-gray-500 text-sm px-4 py-2 rounded-full">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] ${
          isUser
            ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md'
            : 'bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md'
        } px-4 py-3`}
      >
        {/* Agent name badge for assistant messages */}
        {!isUser && message.agentName && (
          <div className="text-xs text-indigo-600 font-medium mb-1">
            {message.agentName}
          </div>
        )}

        {/* Render parts if available, otherwise content */}
        {message.parts && message.parts.length > 0 ? (
          message.parts.map((part, i) => {
            if (part.type === 'text') {
              return (
                <div key={i}>
                  <TextPart content={part.content} />
                </div>
              );
            }
            if (part.type === 'tool-call') {
              const pending = pendingApprovals.find(
                (a) => a.toolCallId === part.id
              );
              return (
                <ToolCallPart
                  key={i}
                  part={part}
                  pendingApproval={pending}
                  onApprove={onApprove}
                  onDeny={onDeny}
                />
              );
            }
            if (part.type === 'tool-result') {
              return <ToolResultPart key={i} part={part} />;
            }
            return null;
          })
        ) : (
          <TextPart content={message.content} />
        )}

        {/* Timestamp */}
        <div
          className={`text-xs mt-2 ${
            isUser ? 'text-indigo-200' : 'text-gray-400'
          }`}
        >
          {new Date(message.createdAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

/**
 * Typing indicator shown while agent is processing.
 */
function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-2">Agent thinking</span>
          <span className="typing-dot w-2 h-2 bg-gray-400 rounded-full" />
          <span className="typing-dot w-2 h-2 bg-gray-400 rounded-full" />
          <span className="typing-dot w-2 h-2 bg-gray-400 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  isLoading,
  pendingApprovals,
  onApprove,
  onDeny,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-lg font-medium">Start a conversation</p>
          <p className="text-sm">Send a message to begin interacting with the agent</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          pendingApprovals={pendingApprovals}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ))}
      {isLoading && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
