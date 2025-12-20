import { useState, useEffect, ReactNode } from 'react';
import type { JournalEvent, PendingTool } from '../types/journal';

interface TimelineProps {
  events: JournalEvent[];
  pendingTool: PendingTool | null;
  onApprove: () => Promise<void>;
  onReject: (feedback: string) => Promise<void>;
  parentRunId?: string | null;
  onNavigateToParent?: () => void;
}

// Cache type for child run events
type ChildRunEventsCache = Map<string, { events: JournalEvent[]; totalEvents: number }>;

// Timeout for fetching child run events (30 seconds)
const CHILD_RUN_FETCH_TIMEOUT_MS = 30000;

const API_BASE = '';
const MAX_INLINE_EVENTS = 100;

export function Timeline({ events, pendingTool, onApprove, onReject, parentRunId, onNavigateToParent }: TimelineProps) {
  const [expandedChildRuns, setExpandedChildRuns] = useState<Set<string>>(new Set());
  const [childRunEventsCache, setChildRunEventsCache] = useState<ChildRunEventsCache>(new Map());

  const toggleChildRun = (childRunId: string) => {
    setExpandedChildRuns((prev) => {
      const next = new Set(prev);
      if (next.has(childRunId)) {
        next.delete(childRunId);
      } else {
        next.add(childRunId);
      }
      return next;
    });
  };

  // Callback to cache fetched child run events
  const onChildRunEventsFetched = (childRunId: string, fetchedEvents: JournalEvent[], totalEvents: number) => {
    setChildRunEventsCache((prev) => {
      const next = new Map(prev);
      next.set(childRunId, { events: fetchedEvents, totalEvents });
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div className="text-gray-400 text-center py-8">
        No events yet. Start a run to see the timeline.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parentRunId && onNavigateToParent && (
        <button
          onClick={onNavigateToParent}
          className="flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors text-sm mb-4"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Back to parent run</span>
        </button>
      )}
      {events.map((event) => (
        <TimelineEntry
          key={event.id}
          event={event}
          expandedChildRuns={expandedChildRuns}
          onToggleChildRun={toggleChildRun}
          childRunEventsCache={childRunEventsCache}
          onChildRunEventsFetched={onChildRunEventsFetched}
        />
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

interface InlineChildRunEventsProps {
  childRunId: string;
  cachedData?: { events: JournalEvent[]; totalEvents: number };
  onEventsFetched: (childRunId: string, events: JournalEvent[], totalEvents: number) => void;
}

/**
 * Inline child run events component
 * Fetches and displays child run events inline with indentation.
 * Uses cache to avoid refetching on expand/collapse toggle.
 */
function InlineChildRunEvents({ childRunId, cachedData, onEventsFetched }: InlineChildRunEventsProps) {
  const [events, setEvents] = useState<JournalEvent[]>(cachedData?.events || []);
  const [isLoading, setIsLoading] = useState(!cachedData);
  const [error, setError] = useState<string | null>(null);
  const [totalEvents, setTotalEvents] = useState(cachedData?.totalEvents || 0);

  useEffect(() => {
    // Skip fetch if we have cached data
    if (cachedData) {
      setEvents(cachedData.events);
      setTotalEvents(cachedData.totalEvents);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHILD_RUN_FETCH_TIMEOUT_MS);

    fetch(`${API_BASE}/runs/${childRunId}`, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error(`Failed to fetch child run: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        const allEvents = data.events || [];
        const limitedEvents = allEvents.slice(0, MAX_INLINE_EVENTS);
        setTotalEvents(allEvents.length);
        setEvents(limitedEvents);
        setIsLoading(false);
        // Cache the fetched events
        onEventsFetched(childRunId, limitedEvents, allEvents.length);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        console.error('Failed to fetch child run events:', err);
        if (err.name === 'AbortError') {
          setError('Request timed out after 30 seconds');
        } else {
          setError(err.message);
        }
        setIsLoading(false);
      });

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [childRunId, cachedData, onEventsFetched]);

  if (isLoading) {
    return (
      <div className="ml-8 mt-2 border-l-2 border-purple-800 pl-4 py-2">
        <div className="flex items-center gap-2 text-purple-400">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Loading child run events...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ml-8 mt-2 border-l-2 border-red-800 pl-4 py-2">
        <div className="text-red-400 text-sm">Failed to load child run: {error}</div>
      </div>
    );
  }

  return (
    <div className="ml-8 mt-2 border-l-2 border-purple-800 pl-4 space-y-3">
      <div className="text-xs text-purple-400 font-medium">Child Run Events ({events.length}{totalEvents > MAX_INLINE_EVENTS ? ` of ${totalEvents}` : ''})</div>
      {events.map((event) => (
        <InlineChildEventEntry key={event.id} event={event} />
      ))}
      {totalEvents > MAX_INLINE_EVENTS && (
        <a
          href={`?runId=${childRunId}`}
          className="inline-block text-purple-400 hover:text-purple-300 text-sm transition-colors"
        >
          View all {totalEvents} events in full child run view
        </a>
      )}
    </div>
  );
}

/**
 * Simplified event entry for inline child run display
 * No recursive child run expansion allowed - must navigate to view nested children
 */
function InlineChildEventEntry({ event }: { event: JournalEvent }) {
  const timestamp = new Date(event.created_at).toLocaleTimeString();

  switch (event.type) {
    case 'RUN_STARTED': {
      const payload = event.payload as { prompt: string };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded">START</span>
          <span className="ml-2 text-gray-400 truncate">{payload.prompt.slice(0, 100)}</span>
        </div>
      );
    }

    case 'AGENT_THOUGHT': {
      const payload = event.payload as { text_content: string };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded">THOUGHT</span>
          <div className="mt-1 text-blue-300/80 text-xs whitespace-pre-wrap pl-4">
            {payload.text_content.slice(0, 300)}{payload.text_content.length > 300 ? '...' : ''}
          </div>
        </div>
      );
    }

    case 'TOOL_PROPOSED': {
      const payload = event.payload as { tool_name: string };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">TOOL</span>
          <span className="ml-2 text-yellow-300">{payload.tool_name}</span>
        </div>
      );
    }

    case 'TOOL_RESULT': {
      const payload = event.payload as { status: string };
      const isSuccess = payload.status === 'success';
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className={`ml-2 px-1.5 py-0.5 rounded ${isSuccess ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
            {isSuccess ? 'SUCCESS' : 'ERROR'}
          </span>
        </div>
      );
    }

    case 'RUN_SUSPENDED': {
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-orange-900/50 text-orange-300 px-1.5 py-0.5 rounded">SUSPENDED</span>
        </div>
      );
    }

    case 'RUN_RESUMED': {
      const payload = event.payload as { decision: string };
      const isApproved = payload.decision === 'approved';
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className={`ml-2 px-1.5 py-0.5 rounded ${isApproved ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
            {isApproved ? 'APPROVED' : 'REJECTED'}
          </span>
        </div>
      );
    }

    case 'RUN_COMPLETED': {
      const payload = event.payload as { summary: string };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-green-600/50 text-green-200 px-1.5 py-0.5 rounded">COMPLETED</span>
          <div className="mt-1 text-green-300/80 text-xs pl-4">
            {payload.summary.slice(0, 200)}{payload.summary.length > 200 ? '...' : ''}
          </div>
        </div>
      );
    }

    case 'SYSTEM_ERROR': {
      const payload = event.payload as { error_details: string };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-red-600/50 text-red-200 px-1.5 py-0.5 rounded">ERROR</span>
          <div className="mt-1 text-red-300/80 text-xs pl-4">
            {payload.error_details.slice(0, 200)}
          </div>
        </div>
      );
    }

    case 'CHILD_RUN_STARTED': {
      const payload = event.payload as { agent_type: string; child_run_id: string };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">DELEGATING</span>
          <span className="ml-2 text-purple-300">{payload.agent_type}</span>
          <a
            href={`?runId=${payload.child_run_id}`}
            className="ml-2 text-purple-400 hover:text-purple-300 underline"
          >
            view
          </a>
        </div>
      );
    }

    case 'CHILD_RUN_COMPLETED': {
      const payload = event.payload as { success: boolean };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className={`ml-2 px-1.5 py-0.5 rounded ${payload.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
            DELEGATION {payload.success ? 'COMPLETE' : 'FAILED'}
          </span>
        </div>
      );
    }

    default:
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className="ml-2 bg-gray-700/50 text-gray-300 px-1.5 py-0.5 rounded">{event.type}</span>
        </div>
      );
  }
}

interface TimelineEntryProps {
  event: JournalEvent;
  expandedChildRuns: Set<string>;
  onToggleChildRun: (childRunId: string) => void;
  childRunEventsCache: ChildRunEventsCache;
  onChildRunEventsFetched: (childRunId: string, events: JournalEvent[], totalEvents: number) => void;
}

function TimelineEntry({ event, expandedChildRuns, onToggleChildRun, childRunEventsCache, onChildRunEventsFetched }: TimelineEntryProps) {
  const timestamp = new Date(event.created_at).toLocaleTimeString();

  switch (event.type) {
    case 'RUN_STARTED': {
      const payload = event.payload as { prompt: string; user_id: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-green-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-green-900 text-green-300 px-2 py-0.5 rounded text-xs">
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
      const payload = event.payload as { reason: string; blocked_by_child_run_id?: string };
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-orange-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-orange-900 text-orange-300 px-2 py-0.5 rounded text-xs">
                SUSPENDED
              </span>
            </div>
            <div className="mt-1 text-orange-300">{payload.reason}</div>
            {payload.blocked_by_child_run_id && (
              <a
                href={`?runId=${payload.blocked_by_child_run_id}`}
                className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block transition-colors"
              >
                View blocking child run
              </a>
            )}
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
      const isExpanded = expandedChildRuns.has(payload.child_run_id);
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-purple-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded text-xs">
                DELEGATING
              </span>
            </div>
            <div className="mt-1">
              <span className="text-gray-400">Agent: </span>
              <span className="text-purple-300 font-medium">{payload.agent_type}</span>
            </div>
            <div className="mt-1 text-gray-400 text-sm">{payload.task}</div>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => onToggleChildRun(payload.child_run_id)}
                className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-sm transition-colors"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>{isExpanded ? 'Collapse' : 'Expand'} child run</span>
              </button>
              <a
                href={`?runId=${payload.child_run_id}`}
                className="text-purple-400 hover:text-purple-300 text-sm underline transition-colors"
              >
                View full child run
              </a>
            </div>
            {isExpanded && (
              <InlineChildRunEvents
                childRunId={payload.child_run_id}
                cachedData={childRunEventsCache.get(payload.child_run_id)}
                onEventsFetched={onChildRunEventsFetched}
              />
            )}
          </div>
        </EntryWrapper>
      );
    }

    case 'CHILD_RUN_COMPLETED': {
      const payload = event.payload as { child_run_id: string; success: boolean; summary: string };
      const isExpanded = expandedChildRuns.has(payload.child_run_id);
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
                DELEGATION {payload.success ? 'COMPLETE' : 'FAILED'}
              </span>
            </div>
            <div className="mt-1 text-gray-300">{payload.summary}</div>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => onToggleChildRun(payload.child_run_id)}
                className={`flex items-center gap-1 text-sm transition-colors ${
                  payload.success
                    ? 'text-green-400 hover:text-green-300'
                    : 'text-red-400 hover:text-red-300'
                }`}
              >
                <svg
                  className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>{isExpanded ? 'Collapse' : 'Expand'} child run</span>
              </button>
              <a
                href={`?runId=${payload.child_run_id}`}
                className={`text-sm underline transition-colors ${
                  payload.success
                    ? 'text-green-400 hover:text-green-300'
                    : 'text-red-400 hover:text-red-300'
                }`}
              >
                View full child run
              </a>
            </div>
            {isExpanded && (
              <InlineChildRunEvents
                childRunId={payload.child_run_id}
                cachedData={childRunEventsCache.get(payload.child_run_id)}
                onEventsFetched={onChildRunEventsFetched}
              />
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
