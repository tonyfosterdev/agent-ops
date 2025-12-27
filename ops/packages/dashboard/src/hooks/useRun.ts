import { useState, useEffect } from 'react';
import type { JournalEvent, RunStatus, PendingTool } from '../types/journal';

interface UseRunResult {
  events: JournalEvent[];
  status: RunStatus;
  pendingTool: PendingTool | null;
  isLoading: boolean;
  error: string | null;
  parentRunId: string | null;
  agentType: string | null;
}

const API_BASE = '';

export function useRun(runId: string | null): UseRunResult {
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [status, setStatus] = useState<RunStatus>('pending');
  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parentRunId, setParentRunId] = useState<string | null>(null);
  const [agentType, setAgentType] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      setStatus('pending');
      setPendingTool(null);
      setParentRunId(null);
      setAgentType(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    // Fetch run metadata to get parent_run_id and agent_type
    fetch(`${API_BASE}/runs/${runId}`)
      .then((res) => res.json())
      .then((data) => {
        setParentRunId(data.parent_run_id || null);
        setAgentType(data.agent_type || null);
      })
      .catch((err) => {
        console.error('Failed to fetch run metadata:', err);
      });

    // Create EventSource for SSE
    const eventSource = new EventSource(`${API_BASE}/runs/${runId}/events`);

    eventSource.addEventListener('event', (e) => {
      try {
        const event = JSON.parse(e.data) as JournalEvent;
        setEvents((prev) => {
          // Avoid duplicates
          if (prev.some((p) => p.id === event.id)) {
            return prev;
          }
          return [...prev, event];
        });

        // Update status based on events
        if (event.type === 'RUN_SUSPENDED') {
          setStatus('suspended');
        } else if (event.type === 'RUN_COMPLETED') {
          setStatus('completed');
        } else if (event.type === 'SYSTEM_ERROR') {
          setStatus('failed');
        } else if (event.type === 'RUN_CANCELLED') {
          setStatus('cancelled');
        } else if (event.type === 'RUN_STARTED') {
          setStatus('running');
        } else if (event.type === 'RUN_RESUMED') {
          setStatus('running');
          setPendingTool(null);
        }

        // Track pending tool
        if (event.type === 'TOOL_PROPOSED') {
          const payload = event.payload as unknown as PendingTool;
          setPendingTool(payload);
        } else if (event.type === 'TOOL_RESULT' || event.type === 'RUN_RESUMED') {
          setPendingTool(null);
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    });

    eventSource.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data);
        setStatus(data.status);
      } catch {
        // Ignore parse errors
      }
      eventSource.close();
    });

    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      setError('Connection lost');
      setIsLoading(false);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId]);

  return { events, status, pendingTool, isLoading, error, parentRunId, agentType };
}

export async function createRun(prompt: string, userId: string): Promise<string> {
  const response = await fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, user_id: userId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create run');
  }

  const data = await response.json();
  return data.id;
}

export async function resumeRun(
  runId: string,
  decision: 'approved' | 'rejected',
  feedback?: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/runs/${runId}/resume`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision, feedback }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to resume run');
  }
}

export async function cancelRun(runId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/runs/${runId}/cancel`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel run');
  }
}
