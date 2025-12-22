import { useState, ReactNode } from 'react';
import type { JournalEvent, PendingTool } from '../types/journal';

interface TimelineProps {
  events: JournalEvent[];
  pendingTool: PendingTool | null;
  onApprove: () => Promise<void>;
  onReject: (feedback: string) => Promise<void>;
}

export function Timeline({ events, pendingTool, onApprove, onReject }: TimelineProps) {
  if (events.length === 0) {
    return (
      <div className="text-gray-400 text-center py-8">
        No events yet. Start a run to see the timeline.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event) => (
        <TimelineEntry key={event.id} event={event} />
      ))}
      {pendingTool && (
        <InlineApproval
          pendingTool={pendingTool}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}
    </div>
  );
}

function InlineApproval({
  pendingTool,
  onApprove,
  onReject,
}: {
  pendingTool: PendingTool;
  onApprove: () => Promise<void>;
  onReject: (feedback: string) => Promise<void>;
}) {
  const [feedback, setFeedback] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onApprove();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onReject(feedback || 'User rejected');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="border-l-4 border-orange-500 pl-4 py-2">
      <div className="bg-orange-900/30 rounded-lg border border-orange-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="bg-orange-600 text-white px-2 py-0.5 rounded text-xs font-medium">
            APPROVAL REQUIRED
          </span>
          <span className="text-orange-300 text-sm">Dangerous tool waiting for your decision</span>
        </div>

        <div className="mb-3">
          <span className="text-sm text-gray-400">Tool:</span>
          <span className="ml-2 font-semibold text-orange-200">{pendingTool.tool_name}</span>
        </div>

        <div className="mb-3">
          <span className="text-sm text-gray-400">Arguments:</span>
          <pre className="mt-1 bg-gray-900/50 rounded p-3 text-sm text-gray-300 overflow-x-auto max-h-32 border border-gray-700">
            {JSON.stringify(pendingTool.args, null, 2)}
          </pre>
        </div>

        <div className="mb-3">
          <input
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="w-full bg-gray-900/50 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
            placeholder="Rejection reason (optional)"
          />
        </div>

        {error && (
          <div className="mb-3 bg-red-900/50 border border-red-700 text-red-300 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleApprove}
            disabled={isLoading}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Processing...' : 'Approve'}
          </button>
          <button
            onClick={handleReject}
            disabled={isLoading}
            className="flex-1 bg-red-600 hover:bg-red-500 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Processing...' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RawEventToggle({ event }: { event: JournalEvent }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-mono">raw</span>
      </button>
      {isOpen && (
        <pre className="mt-2 bg-gray-950 rounded p-3 text-xs text-gray-400 overflow-x-auto border border-gray-800 max-h-64">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

function EntryWrapper({ children, event }: { children: ReactNode; event: JournalEvent }) {
  return (
    <div>
      {children}
      <RawEventToggle event={event} />
    </div>
  );
}

/**
 * Renders an agent type badge prefix if source_agent_type is present
 */
function AgentTypeBadge({ agentType }: { agentType?: string }) {
  if (!agentType) return null;
  return <span className="opacity-70">[{agentType}] </span>;
}

interface TimelineEntryProps {
  event: JournalEvent;
}

function TimelineEntry({ event }: TimelineEntryProps) {
  const timestamp = new Date(event.created_at).toLocaleTimeString();
  const agentType = event.source_agent_type;

  switch (event.type) {
    case 'RUN_STARTED': {
      const payload = event.payload as { prompt: string; user_id: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-green-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-green-900 text-green-300 px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                RUN STARTED
              </span>
            </div>
            <div className="mt-1 text-gray-300">
              <strong className="text-gray-200">Prompt:</strong> {payload.prompt}
            </div>
          </div>
        </EntryWrapper>
      );
    }

    case 'AGENT_THOUGHT': {
      const payload = event.payload as { text_content: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-blue-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                THOUGHT
              </span>
            </div>
            <div className="mt-1 text-blue-300 whitespace-pre-wrap">
              {payload.text_content}
            </div>
          </div>
        </EntryWrapper>
      );
    }

    case 'TOOL_PROPOSED': {
      const payload = event.payload as {
        tool_name: string;
        args: Record<string, unknown>;
        call_id: string;
      };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-yellow-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                TOOL PROPOSED
              </span>
            </div>
            <div className="mt-2 bg-yellow-900/20 rounded p-4 border border-yellow-800">
              <div className="font-semibold text-yellow-300">{payload.tool_name}</div>
              <pre className="mt-2 text-sm text-gray-400 overflow-x-auto">
                {JSON.stringify(payload.args, null, 2)}
              </pre>
            </div>
          </div>
        </EntryWrapper>
      );
    }

    case 'RUN_SUSPENDED': {
      // Child RUN_SUSPENDED events now stream through parent SSE and trigger
      // the pendingTool mechanism - no special handling needed here.
      // The approval UI appears via InlineApproval when pendingTool is set.
      const payload = event.payload as { reason: string; blocked_by_child_run_id?: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-orange-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-orange-900 text-orange-300 px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                SUSPENDED
              </span>
              {payload.blocked_by_child_run_id && (
                <span className="text-gray-500 font-mono" title={payload.blocked_by_child_run_id}>
                  blocked by {payload.blocked_by_child_run_id.slice(0, 8)}
                </span>
              )}
            </div>
            <div className="mt-1 text-orange-300">{payload.reason}</div>
          </div>
        </EntryWrapper>
      );
    }

    case 'RUN_RESUMED': {
      const payload = event.payload as { decision: string; feedback?: string };
      const isApproved = payload.decision === 'approved';
      return (
        <EntryWrapper event={event}>
          <div
            className={`border-l-4 ${isApproved ? 'border-green-500' : 'border-red-500'} pl-4 py-2`}
          >
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs ${
                  isApproved
                    ? 'bg-green-900 text-green-300'
                    : 'bg-red-900 text-red-300'
                }`}
              >
                <AgentTypeBadge agentType={agentType} />
                {isApproved ? 'APPROVED' : 'REJECTED'}
              </span>
            </div>
            {payload.feedback && (
              <div className="mt-1 text-gray-400 italic">{payload.feedback}</div>
            )}
          </div>
        </EntryWrapper>
      );
    }

    case 'TOOL_RESULT': {
      const payload = event.payload as {
        call_id: string;
        output_data: unknown;
        status: string;
      };
      const isSuccess = payload.status === 'success';
      return (
        <EntryWrapper event={event}>
          <div
            className={`border-l-4 ${isSuccess ? 'border-green-500' : 'border-red-500'} pl-4 py-2`}
          >
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs ${
                  isSuccess
                    ? 'bg-green-900 text-green-300'
                    : 'bg-red-900 text-red-300'
                }`}
              >
                <AgentTypeBadge agentType={agentType} />
                {isSuccess ? 'SUCCESS' : 'ERROR'}
              </span>
            </div>
            <div className="mt-2 bg-gray-900/50 rounded p-2 border border-gray-700">
              <pre className="text-sm text-gray-400 overflow-x-auto max-h-48">
                {typeof payload.output_data === 'string'
                  ? payload.output_data.slice(0, 500)
                  : JSON.stringify(payload.output_data, null, 2).slice(0, 500)}
              </pre>
            </div>
          </div>
        </EntryWrapper>
      );
    }

    case 'RUN_COMPLETED': {
      const payload = event.payload as { summary: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-green-600 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-green-600 text-white px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                COMPLETED
              </span>
            </div>
            <div className="mt-1 text-green-300">{payload.summary}</div>
          </div>
        </EntryWrapper>
      );
    }

    case 'SYSTEM_ERROR': {
      const payload = event.payload as { error_details: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-red-600 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-red-600 text-white px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                ERROR
              </span>
            </div>
            <div className="mt-1 text-red-400">{payload.error_details}</div>
          </div>
        </EntryWrapper>
      );
    }

    case 'CHILD_RUN_STARTED': {
      const payload = event.payload as { child_run_id: string; agent_type: string; task: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-purple-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                DELEGATING
              </span>
              <span className="text-purple-300 font-medium">{payload.agent_type}</span>
              <span className="text-gray-500 font-mono" title={payload.child_run_id}>{payload.child_run_id.slice(0, 8)}</span>
            </div>
            <div className="mt-1 text-gray-400 text-sm">{payload.task}</div>
          </div>
        </EntryWrapper>
      );
    }

    case 'CHILD_RUN_COMPLETED': {
      const payload = event.payload as { child_run_id: string; success: boolean; summary: string };
      return (
        <EntryWrapper event={event}>
          <div
            className={`border-l-4 ${payload.success ? 'border-green-500' : 'border-red-500'} pl-4 py-2`}
          >
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs ${
                  payload.success
                    ? 'bg-green-900 text-green-300'
                    : 'bg-red-900 text-red-300'
                }`}
              >
                <AgentTypeBadge agentType={agentType} />
                DELEGATION {payload.success ? 'COMPLETE' : 'FAILED'}
              </span>
              <span className="text-gray-500 font-mono" title={payload.child_run_id}>{payload.child_run_id.slice(0, 8)}</span>
            </div>
            <div className="mt-1 text-gray-300">{payload.summary}</div>
          </div>
        </EntryWrapper>
      );
    }

    case 'RUN_CANCELLED': {
      const payload = event.payload as { reason?: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-gray-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-gray-600 text-white px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                CANCELLED
              </span>
            </div>
            {payload.reason && (
              <div className="mt-1 text-gray-400">{payload.reason}</div>
            )}
          </div>
        </EntryWrapper>
      );
    }

    default:
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-gray-600 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-xs">
                <AgentTypeBadge agentType={agentType} />
                {event.type}
              </span>
            </div>
            <pre className="mt-1 text-sm text-gray-400">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>
        </EntryWrapper>
      );
  }
}
