import { useState, useRef, useEffect } from 'react';
import { useRun, createRun, resumeRun } from './hooks/useRun';
import { Timeline } from './components/Timeline';
import { CreateRunForm } from './components/CreateRunForm';

function App() {
  // Parse runId from URL on initial load
  const [runId, setRunId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('runId');
  });
  const { events, status, pendingTool, isLoading, error, parentRunId } = useRun(runId);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const handleApprove = async () => {
    if (!runId) return;
    await resumeRun(runId, 'approved');
  };

  const handleReject = async (feedback: string) => {
    if (!runId) return;
    await resumeRun(runId, 'rejected', feedback);
  };

  const handleNewRun = () => {
    setRunId(null);
  };

  // Auto-scroll to bottom when events change
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, pendingTool]);

  return (
    <div className="min-h-screen bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-100">Agent Dashboard</h1>
              <p className="text-gray-400 text-sm mt-1">
                Durable Run Architecture - Event Journal Visualization
              </p>
            </div>
            {runId && (
              <button
                onClick={handleNewRun}
                className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                New Run
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {!runId ? (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-100 mb-4">Start a New Run</h2>
            <CreateRunForm onCreated={setRunId} onCreate={createRun} />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Run Info */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-400">Run ID:</span>
                  <span className="ml-2 font-mono text-sm text-gray-300">{runId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Status:</span>
                  <StatusBadge status={status} />
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Timeline */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-100 mb-4">Event Timeline</h2>
              {isLoading && events.length === 0 ? (
                <div className="text-gray-400 text-center py-8">Loading...</div>
              ) : (
                <Timeline
                  events={events}
                  pendingTool={status === 'suspended' ? pendingTool : null}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  parentRunId={parentRunId}
                  onNavigateToParent={() => {
                    if (parentRunId) {
                      setRunId(parentRunId);
                      window.history.pushState({}, '', `?runId=${parentRunId}`);
                    }
                  }}
                />
              )}
              <div ref={timelineEndRef} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-700 text-gray-300',
    running: 'bg-blue-900 text-blue-300',
    suspended: 'bg-orange-900 text-orange-300',
    completed: 'bg-green-900 text-green-300',
    failed: 'bg-red-900 text-red-300',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status] || colors.pending}`}>
      {status.toUpperCase()}
    </span>
  );
}

export default App;
