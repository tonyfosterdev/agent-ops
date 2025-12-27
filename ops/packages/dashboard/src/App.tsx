import { useState, useRef, useEffect } from 'react';
import { useRun, createRun, resumeRun, cancelRun } from './hooks/useRun';
import { Timeline } from './components/Timeline';
import { CreateRunForm } from './components/CreateRunForm';

function App() {
  // Parse runId from URL on initial load
  const [runId, setRunId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('runId');
  });
  const { events, status, pendingTool, isLoading, error, parentRunId, agentType } = useRun(runId);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

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

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = async () => {
    if (!runId) return;
    setIsCancelling(true);
    try {
      await cancelRun(runId);
      setShowCancelConfirm(false);
    } catch (err: unknown) {
      console.error('Failed to cancel run:', err);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleCancelDismiss = () => {
    setShowCancelConfirm(false);
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
                <div className="space-y-1">
                  <div>
                    <span className="text-sm text-gray-400">Run ID:</span>
                    <span className="ml-2 font-mono text-sm text-gray-300">{runId}</span>
                  </div>
                  {agentType && (
                    <div>
                      <span className="text-sm text-gray-400">Agent:</span>
                      <span className="ml-2 text-sm text-purple-300 font-medium">{agentType}</span>
                    </div>
                  )}
                  {parentRunId && (
                    <div>
                      <span className="text-sm text-gray-400">Parent Run:</span>
                      <span className="ml-2 font-mono text-sm text-gray-500" title={parentRunId}>
                        {parentRunId.slice(0, 8)}...
                      </span>
                    </div>
                  )}
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
                />
              )}
              <div ref={timelineEndRef} />
            </div>
          </div>
        )}
      </main>

      {/* Fixed Stop Run button */}
      {runId && (status === 'running' || status === 'suspended') && (
        <div className="fixed bottom-6 right-6">
          <button
            onClick={handleCancelClick}
            className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-lg font-medium shadow-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Stop Run
          </button>
        </div>
      )}

      {/* Cancel confirmation dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Stop Run?</h3>
            <p className="text-gray-400 mb-4">
              This will mark the run as cancelled. The agent may take a moment to stop if it is currently processing.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelDismiss}
                disabled={isCancelling}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium transition-colors disabled:opacity-50"
              >
                Keep Running
              </button>
              <button
                onClick={handleCancelConfirm}
                disabled={isCancelling}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isCancelling ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Stopping...
                  </>
                ) : (
                  'Stop Run'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
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
    cancelled: 'bg-yellow-900 text-yellow-300',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status] || colors.pending}`}>
      {status.toUpperCase()}
    </span>
  );
}

export default App;
