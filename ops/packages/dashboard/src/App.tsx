import { useState } from 'react';
import { useRun, createRun, resumeRun } from './hooks/useRun';
import { Timeline } from './components/Timeline';
import { ApprovalModal } from './components/ApprovalModal';
import { CreateRunForm } from './components/CreateRunForm';

function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const { events, status, pendingTool, isLoading, error } = useRun(runId);

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

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Agent Dashboard</h1>
              <p className="text-gray-500 text-sm mt-1">
                Durable Run Architecture - Event Journal Visualization
              </p>
            </div>
            {runId && (
              <button
                onClick={handleNewRun}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                New Run
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {!runId ? (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Start a New Run</h2>
            <CreateRunForm onCreated={setRunId} onCreate={createRun} />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Run Info */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-gray-500">Run ID:</span>
                  <span className="ml-2 font-mono text-sm text-gray-700">{runId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Status:</span>
                  <StatusBadge status={status} />
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Timeline */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Event Timeline</h2>
              {isLoading && events.length === 0 ? (
                <div className="text-gray-500 text-center py-8">Loading...</div>
              ) : (
                <Timeline events={events} />
              )}
            </div>

            {/* Approval Modal */}
            {status === 'suspended' && pendingTool && (
              <ApprovalModal
                runId={runId}
                pendingTool={pendingTool}
                onApprove={handleApprove}
                onReject={handleReject}
                onClose={() => {}}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    running: 'bg-blue-100 text-blue-700',
    suspended: 'bg-orange-100 text-orange-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors[status] || colors.pending}`}>
      {status.toUpperCase()}
    </span>
  );
}

export default App;
