/**
 * MessageList Component - Renders chat messages with proper formatting.
 *
 * Handles different message types from @inngest/use-agent:
 * - User messages (right-aligned, blue)
 * - Assistant messages (left-aligned, gray)
 * - Tool calls and results within message parts
 * - HITL approval parts for dangerous tools
 *
 * ## Features
 * - Real-time streaming message updates
 * - Auto-scroll to bottom on new messages
 * - Markdown-like code block rendering
 * - Tool call visualization with approval UI
 * - Typing indicator during loading
 */

import { useEffect, useRef } from 'react';
import type { ConversationMessage, MessagePart, TextUIPart, HitlUIPart } from '@inngest/use-agent';
import { ToolApproval } from './ToolApproval';
import { WaitingForApprovalIndicator } from './StatusMessage';

// Type helpers for working with the generic MessagePart type
type AnyPart = MessagePart;
type ToolCallPart = Extract<AnyPart, { type: 'tool-call' }>;

export interface MessageListProps {
  /** Messages from useAgents hook */
  messages: ConversationMessage[];
  /** Whether agent is currently processing */
  isLoading: boolean;
  /** Whether agent is waiting for human approval */
  isWaitingForApproval: boolean;
  /** Callback for tool approval */
  onApprove: (toolCallId: string) => void;
  /** Callback for tool rejection */
  onDeny: (toolCallId: string, reason: string) => void;
}

/**
 * Render a text part with basic markdown support.
 */
function TextPartRenderer({ content }: { content: string }) {
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
                    className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-sm font-mono"
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
 * Render a tool call part with status.
 * The ToolCallUIPart uses 'state' instead of 'status' and has different shape.
 */
function ToolCallPartRenderer({
  part,
  onApprove,
  onDeny,
}: {
  part: ToolCallPart;
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string, reason: string) => void;
}) {
  // The part has: toolCallId, toolName, state, input, output, error
  // For HITL-enabled parts, we also have hitlRequestId attached by Chat.tsx
  const toolCallId = part.toolCallId;
  const toolName = part.toolName;
  const state = part.state;
  const input = part.input as Record<string, unknown> | undefined;

  // Get the HITL request ID if present (attached by Chat.tsx merge logic)
  // This is the ID to use for approvals - it's the UUID our tool handlers generate
  // which is different from the AgentKit-generated toolCallId
  const hitlRequestId = (part as ToolCallPart & { hitlRequestId?: string }).hitlRequestId;
  const approvalId = hitlRequestId || toolCallId;

  // If awaiting approval, show approval UI
  if (state === 'awaiting-approval') {
    return (
      <ToolApproval
        tool={{ id: approvalId, name: String(toolName), args: input ?? {} }}
        onApprove={() => onApprove(approvalId)}
        onDeny={(reason) => onDeny(approvalId, reason)}
      />
    );
  }

  // Map state to colors
  const stateColors: Record<string, string> = {
    'input-streaming': 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800',
    'input-available': 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
    'awaiting-approval': 'bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-800',
    'executing': 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800',
    'output-available': 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800',
  };

  const colors = stateColors[state] || stateColors['output-available'];
  const isComplete = state === 'output-available';

  return (
    <div className={`${colors} border rounded-lg p-3 my-2 text-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <svg
          className="w-4 h-4 text-gray-500 dark:text-gray-400"
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
        <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{String(toolName)}</span>
        {!isComplete && (
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              state === 'input-streaming' || state === 'executing'
                ? 'bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200'
                : 'bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200'
            }`}
          >
            {state}
          </span>
        )}
      </div>
      {input && (
        <pre className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded p-2 overflow-x-auto text-xs font-mono">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
      {/* Show output if available */}
      {state === 'output-available' && part.output !== undefined && (
        <div className="mt-2 bg-gray-900 dark:bg-gray-950 text-gray-100 rounded p-2 overflow-x-auto text-xs font-mono">
          {typeof part.output === 'string'
            ? String(part.output)
            : JSON.stringify(part.output, null, 2)}
        </div>
      )}
    </div>
  );
}

/**
 * Render a HITL (Human-in-the-Loop) part for tool approvals.
 * HitlUIPart has: id, toolCalls[], status, expiresAt?, resolvedBy?, resolvedAt?, metadata?
 */
function HitlPartRenderer({
  part,
  onApprove,
  onDeny,
}: {
  part: HitlUIPart;
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string, reason: string) => void;
}) {
  const { id, toolCalls, status, metadata } = part;
  const reason = metadata?.reason;

  // Show approval UI if pending
  if (status === 'pending') {
    // For each tool call in the HITL request, show approval UI
    // Use the HITL part id as the tool call id for approval
    const firstTool = toolCalls[0];
    if (firstTool) {
      return (
        <ToolApproval
          tool={{ id, name: firstTool.toolName, args: (firstTool.toolInput ?? {}) as Record<string, unknown> }}
          reason={reason}
          onApprove={() => onApprove(id)}
          onDeny={(denyReason) => onDeny(id, denyReason)}
        />
      );
    }
  }

  // Show resolution status
  const isApproved = status === 'approved';
  const toolNames = toolCalls.map((tc) => tc.toolName).join(', ');
  return (
    <div
      className={`${
        isApproved
          ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
          : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
      } border rounded-lg p-3 my-2 text-sm`}
    >
      <div className="flex items-center gap-2">
        {isApproved ? (
          <svg
            className="w-4 h-4 text-green-500 dark:text-green-400"
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
        ) : (
          <svg
            className="w-4 h-4 text-red-500 dark:text-red-400"
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
        )}
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {toolNames} - {isApproved ? 'Approved' : 'Denied'}
        </span>
      </div>
    </div>
  );
}

/**
 * Render a single part based on its type.
 */
function PartRenderer({
  part,
  onApprove,
  onDeny,
}: {
  part: AnyPart;
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string, reason: string) => void;
}) {
  switch (part.type) {
    case 'text': {
      const textPart = part as TextUIPart;
      return <TextPartRenderer content={textPart.content} />;
    }
    case 'tool-call': {
      const toolPart = part as ToolCallPart;
      return (
        <ToolCallPartRenderer
          part={toolPart}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      );
    }
    case 'hitl': {
      const hitlPart = part as HitlUIPart;
      return (
        <HitlPartRenderer
          part={hitlPart}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      );
    }
    default:
      // Handle other part types gracefully
      return null;
  }
}

/**
 * Single message component.
 */
function MessageItem({
  message,
  onApprove,
  onDeny,
}: {
  message: ConversationMessage;
  onApprove: (toolCallId: string) => void;
  onDeny: (toolCallId: string, reason: string) => void;
}) {
  const isUser = message.role === 'user';

  // Get text content from message
  const textContent = message.parts
    ?.filter((p): p is TextUIPart => p.type === 'text')
    .map((p) => p.content)
    .join('') ?? '';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] ${
          isUser
            ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-md'
        } px-4 py-3`}
      >
        {/* Render parts if available */}
        {message.parts && message.parts.length > 0 ? (
          message.parts.map((part, i) => (
            <PartRenderer
              key={i}
              part={part}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          ))
        ) : (
          // Fallback - show nothing if no parts
          textContent && <TextPartRenderer content={textContent} />
        )}

        {/* Timestamp */}
        {message.timestamp && (
          <div
            className={`text-xs mt-2 ${
              isUser ? 'text-indigo-200' : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            {message.timestamp.toLocaleTimeString()}
          </div>
        )}
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
      <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">Agent thinking</span>
          <span className="typing-dot w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full" />
          <span className="typing-dot w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full" />
          <span className="typing-dot w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  isLoading,
  isWaitingForApproval,
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
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600"
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
      {messages.map((message, i) => (
        <MessageItem
          key={message.id || i}
          message={message}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ))}
      {/* Show appropriate indicator based on state */}
      {isLoading && !isWaitingForApproval && <TypingIndicator />}
      {isWaitingForApproval && <WaitingForApprovalIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
