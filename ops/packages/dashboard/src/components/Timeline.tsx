import { useState, useEffect, useCallback, ReactNode } from 'react';
import type { JournalEvent, PendingTool } from '../types/journal';
import { resumeRun } from '../hooks/useRun';

interface TimelineProps {
  events: JournalEvent[];
  pendingTool: PendingTool | null;
  onApprove: () => Promise<void>;
  onReject: (feedback: string) => Promise<void>;
}

// Cache type for child run events
type ChildRunEventsCache = Map<string, { events: JournalEvent[]; totalEvents: number }>;

// Timeout for fetching child run events (30 seconds)
const CHILD_RUN_FETCH_TIMEOUT_MS = 30000;

// Retry configuration for child run events fetch
const MAX_CHILD_RUN_RETRIES = 5;
const CHILD_RUN_RETRY_DELAY_MS = 500;

// Max poll attempts for child approval (2 minutes at 2-second intervals)
const MAX_APPROVAL_POLL_ATTEMPTS = 60;

const API_BASE = '';
const MAX_INLINE_EVENTS = 100;
const MAX_CHILD_DEPTH = 5;

export function Timeline({ events, pendingTool, onApprove, onReject }: TimelineProps) {
  // Track collapsed child runs (default is expanded)
  const [collapsedChildRuns, setCollapsedChildRuns] = useState<Set<string>>(new Set());
  const [childRunEventsCache, setChildRunEventsCache] = useState<ChildRunEventsCache>(new Map());

  const toggleChildRun = (childRunId: string) => {
    setCollapsedChildRuns((prev) => {
      const next = new Set(prev);
      if (next.has(childRunId)) {
        next.delete(childRunId);
      } else {
        next.add(childRunId);
      }
      return next;
    });
  };

  // Callback to cache fetched child run events - wrapped in useCallback to prevent unnecessary re-renders
  const onChildRunEventsFetched = useCallback((childRunId: string, fetchedEvents: JournalEvent[], totalEvents: number) => {
    setChildRunEventsCache((prev) => {
      const next = new Map(prev);
      next.set(childRunId, { events: fetchedEvents, totalEvents });
      return next;
    });
  }, []);

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
        <TimelineEntry
          key={event.id}
          event={event}
          collapsedChildRuns={collapsedChildRuns}
          onToggleChildRun={toggleChildRun}
          childRunEventsCache={childRunEventsCache}
          onChildRunEventsFetched={onChildRunEventsFetched}
          depth={0}
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

/**
 * Component to display and handle child run approval inline in parent's timeline.
 * Fetches child's pending tool and provides approve/reject buttons.
 * Polls every 2 seconds while waiting for pending tool data.
 * Uses AbortController with timeout and bounded polling to prevent infinite loops.
 */
function ChildApprovalInline({ childRunId }: { childRunId: string }) {
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [childStatus, setChildStatus] = useState<string | null>(null);
  const [isResolved, setIsResolved] = useState(false);

  useEffect(() => {
    // Stop polling after user has submitted approval/rejection
    if (isResolved) return;

    let pollTimeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let pollCount = 0;

    const fetchChildSnapshot = async () => {
      // Check poll limit BEFORE making the fetch call
      if (pollCount >= MAX_APPROVAL_POLL_ATTEMPTS) {
        setError('Timed out waiting for child approval data');
        setIsLoading(false);
        return;
      }
      pollCount++;

      const controller = new AbortController();
      const fetchTimeoutId = setTimeout(() => controller.abort(), CHILD_RUN_FETCH_TIMEOUT_MS);

      try {
        const res = await fetch(`${API_BASE}/runs/${childRunId}/events/snapshot?limit=1`, {
          signal: controller.signal
        });
        clearTimeout(fetchTimeoutId);

        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const data = await res.json();

        if (cancelled) return;

        setChildStatus(data.status);

        if (data.pending_tool) {
          setPendingTool(data.pending_tool);
          setIsLoading(false);
        } else if (data.status === 'suspended') {
          // Suspended but no pending_tool yet - poll again
          pollTimeoutId = setTimeout(fetchChildSnapshot, 2000);
        } else {
          // Child run completed/no longer suspended
          setIsLoading(false);
        }
      } catch (err: any) {
        clearTimeout(fetchTimeoutId);
        if (cancelled) return;
        if (err.name === 'AbortError') {
          setError('Request timed out');
        } else {
          setError(err.message);
        }
        setIsLoading(false);
      }
    };

    fetchChildSnapshot();

    return () => {
      cancelled = true;
      if (pollTimeoutId) clearTimeout(pollTimeoutId);
    };
  }, [childRunId, isResolved]);

  const handleApprove = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await resumeRun(childRunId, 'approved');
      setIsResolved(true); // Stop polling after successful approval
      setPendingTool(null); // Clear after successful approval
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await resumeRun(childRunId, 'rejected', feedback || 'User rejected');
      setIsResolved(true); // Stop polling after successful rejection
      setPendingTool(null); // Clear after successful rejection
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mt-3 bg-orange-900/20 rounded-lg border border-orange-700 p-4">
        <div className="flex items-center gap-2 text-orange-400">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm">Loading child approval request...</span>
        </div>
      </div>
    );
  }

  if (error && !pendingTool) {
    return (
      <div className="mt-3 bg-red-900/30 rounded-lg border border-red-700 p-4">
        <div className="text-red-400 text-sm">Failed to load child approval: {error}</div>
      </div>
    );
  }

  if (!pendingTool) {
    return (
      <div className="mt-3 bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <div className="text-gray-400 text-sm">
          Child run {childStatus === 'suspended' ? 'is suspended but has no pending tool.' : 'no longer requires approval.'}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 bg-orange-900/30 rounded-lg border border-orange-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="bg-purple-600 text-white px-2 py-0.5 rounded text-xs font-medium">
          CHILD APPROVAL
        </span>
        <span className="text-orange-300 text-sm">Child agent needs approval</span>
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
          disabled={isSubmitting}
          className="flex-1 bg-green-600 hover:bg-green-500 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Processing...' : 'Approve'}
        </button>
        <button
          onClick={handleReject}
          disabled={isSubmitting}
          className="flex-1 bg-red-600 hover:bg-red-500 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Processing...' : 'Reject'}
        </button>
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
  depth: number;
  collapsedChildRuns: Set<string>;
  onToggleChildRun: (childRunId: string) => void;
  childRunEventsCache: ChildRunEventsCache;
}

/**
 * Inline child run events component
 * Fetches and displays child run events inline with indentation.
 * Uses cache to avoid refetching on expand/collapse toggle.
 * Implements bounded retry for race condition when parent emits CHILD_RUN_STARTED
 * before child's RUN_STARTED event exists.
 * Supports recursive child run display up to MAX_CHILD_DEPTH.
 */
function InlineChildRunEvents({
  childRunId,
  cachedData,
  onEventsFetched,
  depth,
  collapsedChildRuns,
  onToggleChildRun,
  childRunEventsCache
}: InlineChildRunEventsProps) {
  const [childAgentType, setChildAgentType] = useState<string | null>(null);
  const [events, setEvents] = useState<JournalEvent[]>(cachedData?.events || []);
  const [isLoading, setIsLoading] = useState(!cachedData);
  const [error, setError] = useState<string | null>(null);
  const [totalEvents, setTotalEvents] = useState(cachedData?.totalEvents || 0);
  const [retryCount, setRetryCount] = useState(0);
  const [maxRetriesReached, setMaxRetriesReached] = useState(false);

  useEffect(() => {
    // Skip fetch if we have cached data with events
    if (cachedData && cachedData.events.length > 0) {
      setEvents(cachedData.events);
      setTotalEvents(cachedData.totalEvents);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let currentRetry = 0;

    const fetchWithRetry = async () => {
      setIsLoading(true);
      setError(null);

      while (!cancelled && currentRetry <= MAX_CHILD_RUN_RETRIES) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), CHILD_RUN_FETCH_TIMEOUT_MS);

          const res = await fetch(`${API_BASE}/runs/${childRunId}/events/snapshot?limit=${MAX_INLINE_EVENTS}`, {
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!res.ok) throw new Error(`Failed to fetch child run: ${res.status}`);
          const data = await res.json();

          if (cancelled) return;

          const fetchedEvents = data.events || [];
          const runStatus = data.status;

          // If no events but run still starting, retry with bounded attempts
          if (fetchedEvents.length === 0 &&
              (runStatus === 'pending' || runStatus === 'running') &&
              currentRetry < MAX_CHILD_RUN_RETRIES) {
            currentRetry++;
            setRetryCount(currentRetry);
            await new Promise(resolve => setTimeout(resolve, CHILD_RUN_RETRY_DELAY_MS));
            continue;
          }

          // Success or max retries reached
          setTotalEvents(data.total_count || fetchedEvents.length);
          setEvents(fetchedEvents);
          setChildAgentType(data.agent_type || null);
          setMaxRetriesReached(fetchedEvents.length === 0 && currentRetry >= MAX_CHILD_RUN_RETRIES);
          setIsLoading(false);

          // Only cache if we have events
          if (fetchedEvents.length > 0) {
            onEventsFetched(childRunId, fetchedEvents, data.total_count || fetchedEvents.length);
          }
          return;
        } catch (err: any) {
          if (cancelled) return;
          console.error('Failed to fetch child run events:', err);
          if (err.name === 'AbortError') {
            setError('Request timed out after 30 seconds');
          } else {
            setError(err.message);
          }
          setIsLoading(false);
          return;
        }
      }
    };

    fetchWithRetry();

    return () => {
      cancelled = true;
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
          <span className="text-sm">
            {retryCount > 0
              ? `Loading child run events (attempt ${retryCount + 1}/${MAX_CHILD_RUN_RETRIES + 1})...`
              : 'Loading child run events...'}
          </span>
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

  // Show helpful message after max retries with no events
  if (events.length === 0 && maxRetriesReached) {
    return (
      <div className="ml-8 mt-2 border-l-2 border-yellow-800 pl-4 py-2">
        <div className="text-yellow-400 text-sm">
          Child run has not produced events yet.
        </div>
      </div>
    );
  }

  // Generate depth-based border colors for visual hierarchy
  const borderColors = [
    'border-purple-800',
    'border-purple-700',
    'border-purple-600',
    'border-indigo-700',
    'border-indigo-600',
  ];
  const borderColor = borderColors[Math.min(depth, borderColors.length - 1)];

  return (
    <div className={`ml-8 mt-2 border-l-2 ${borderColor} pl-4 space-y-3`}>
      <div className="text-xs text-purple-400 font-medium flex items-center gap-2">
        <span>Child Run Events ({events.length}{totalEvents > MAX_INLINE_EVENTS ? ` of ${totalEvents}` : ''})</span>
        {childAgentType && (
          <span className="bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">{childAgentType}</span>
        )}
        <span className="text-gray-500 font-mono" title={childRunId}>{childRunId.slice(0, 8)}</span>
      </div>
      {events.map((event) => (
        <InlineChildEventEntry
          key={event.id}
          event={event}
          depth={depth}
          collapsedChildRuns={collapsedChildRuns}
          onToggleChildRun={onToggleChildRun}
          childRunEventsCache={childRunEventsCache}
          onChildRunEventsFetched={onEventsFetched}
        />
      ))}
      {totalEvents > MAX_INLINE_EVENTS && (
        <div className="text-gray-500 text-sm">
          Showing first {MAX_INLINE_EVENTS} of {totalEvents} events
        </div>
      )}
    </div>
  );
}

interface InlineChildEventEntryProps {
  event: JournalEvent;
  depth: number;
  collapsedChildRuns: Set<string>;
  onToggleChildRun: (childRunId: string) => void;
  childRunEventsCache: ChildRunEventsCache;
  onChildRunEventsFetched: (childRunId: string, events: JournalEvent[], totalEvents: number) => void;
}

/**
 * Event entry for inline child run display
 * Supports recursive child run expansion up to MAX_CHILD_DEPTH
 */
function InlineChildEventEntry({
  event,
  depth,
  collapsedChildRuns,
  onToggleChildRun,
  childRunEventsCache,
  onChildRunEventsFetched
}: InlineChildEventEntryProps) {
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
      const payload = event.payload as { agent_type: string; child_run_id: string; task?: string };
      const nextDepth = depth + 1;
      const isCollapsed = collapsedChildRuns.has(payload.child_run_id);
      const isMaxDepth = nextDepth >= MAX_CHILD_DEPTH;

      return (
        <div className="text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-mono">{timestamp}</span>
            <span className="bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">DELEGATING</span>
            <span className="text-purple-300">{payload.agent_type}</span>
            <span className="text-gray-500 font-mono" title={payload.child_run_id}>{payload.child_run_id.slice(0, 8)}</span>
            {!isMaxDepth && (
              <button
                onClick={() => onToggleChildRun(payload.child_run_id)}
                className="flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
              </button>
            )}
          </div>
          {payload.task && (
            <div className="mt-1 text-gray-400 pl-4">{payload.task.slice(0, 100)}</div>
          )}
          {isMaxDepth && (
            <div className="mt-1 text-gray-500 text-xs pl-4">Max depth reached</div>
          )}
          {!isMaxDepth && !isCollapsed && (
            <InlineChildRunEvents
              childRunId={payload.child_run_id}
              cachedData={childRunEventsCache.get(payload.child_run_id)}
              onEventsFetched={onChildRunEventsFetched}
              depth={nextDepth}
              collapsedChildRuns={collapsedChildRuns}
              onToggleChildRun={onToggleChildRun}
              childRunEventsCache={childRunEventsCache}
            />
          )}
        </div>
      );
    }

    case 'CHILD_RUN_COMPLETED': {
      const payload = event.payload as { success: boolean; child_run_id?: string };
      return (
        <div className="text-xs">
          <span className="text-gray-500 font-mono">{timestamp}</span>
          <span className={`ml-2 px-1.5 py-0.5 rounded ${payload.success ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
            DELEGATION {payload.success ? 'COMPLETE' : 'FAILED'}
          </span>
          {payload.child_run_id && (
            <span className="ml-2 text-gray-500 font-mono" title={payload.child_run_id}>{payload.child_run_id.slice(0, 8)}</span>
          )}
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
  collapsedChildRuns: Set<string>;
  onToggleChildRun: (childRunId: string) => void;
  childRunEventsCache: ChildRunEventsCache;
  onChildRunEventsFetched: (childRunId: string, events: JournalEvent[], totalEvents: number) => void;
  depth: number;
}

function TimelineEntry({
  event,
  collapsedChildRuns,
  onToggleChildRun,
  childRunEventsCache,
  onChildRunEventsFetched,
  depth
}: TimelineEntryProps) {
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
              {payload.blocked_by_child_run_id && (
                <span className="text-gray-500 font-mono" title={payload.blocked_by_child_run_id}>
                  blocked by {payload.blocked_by_child_run_id.slice(0, 8)}
                </span>
              )}
            </div>
            <div className="mt-1 text-orange-300">{payload.reason}</div>
            {payload.blocked_by_child_run_id && (
              <ChildApprovalInline childRunId={payload.blocked_by_child_run_id} />
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
      const isCollapsed = collapsedChildRuns.has(payload.child_run_id);
      return (
        <EntryWrapper event={event}>
          <div className="border-l-4 border-purple-500 pl-4 py-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="font-mono">{timestamp}</span>
              <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded text-xs">
                DELEGATING
              </span>
              <span className="text-purple-300 font-medium">{payload.agent_type}</span>
              <span className="text-gray-500 font-mono" title={payload.child_run_id}>{payload.child_run_id.slice(0, 8)}</span>
            </div>
            <div className="mt-1 text-gray-400 text-sm">{payload.task}</div>
            <div className="flex gap-3 mt-2">
              <button
                onClick={() => onToggleChildRun(payload.child_run_id)}
                className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-sm transition-colors"
              >
                <svg
                  className={`w-4 h-4 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>{isCollapsed ? 'Expand' : 'Collapse'} child run</span>
              </button>
            </div>
            {!isCollapsed && (
              <InlineChildRunEvents
                childRunId={payload.child_run_id}
                cachedData={childRunEventsCache.get(payload.child_run_id)}
                onEventsFetched={onChildRunEventsFetched}
                depth={depth + 1}
                collapsedChildRuns={collapsedChildRuns}
                onToggleChildRun={onToggleChildRun}
                childRunEventsCache={childRunEventsCache}
              />
            )}
          </div>
        </EntryWrapper>
      );
    }

    case 'CHILD_RUN_COMPLETED': {
      const payload = event.payload as { child_run_id: string; success: boolean; summary: string };
      const isCollapsed = collapsedChildRuns.has(payload.child_run_id);
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
              <span className="text-gray-500 font-mono" title={payload.child_run_id}>{payload.child_run_id.slice(0, 8)}</span>
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
                  className={`w-4 h-4 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span>{isCollapsed ? 'Expand' : 'Collapse'} child run</span>
              </button>
            </div>
            {!isCollapsed && (
              <InlineChildRunEvents
                childRunId={payload.child_run_id}
                cachedData={childRunEventsCache.get(payload.child_run_id)}
                onEventsFetched={onChildRunEventsFetched}
                depth={depth + 1}
                collapsedChildRuns={collapsedChildRuns}
                onToggleChildRun={onToggleChildRun}
                childRunEventsCache={childRunEventsCache}
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
