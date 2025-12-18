import { useState } from 'react';
import type { PendingTool } from '../types/journal';

interface ApprovalModalProps {
  runId: string;
  pendingTool: PendingTool;
  onApprove: () => Promise<void>;
  onReject: (feedback: string) => Promise<void>;
  onClose: () => void;
}

export function ApprovalModal({
  runId,
  pendingTool,
  onApprove,
  onReject,
  onClose,
}: ApprovalModalProps) {
  const [feedback, setFeedback] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onApprove();
      onClose();
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
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        <div className="bg-orange-500 px-6 py-4">
          <h2 className="text-xl font-bold text-white">Approval Required</h2>
          <p className="text-orange-100 text-sm mt-1">
            A dangerous tool is waiting for your approval
          </p>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <span className="text-sm text-gray-500">Tool:</span>
            <div className="font-semibold text-lg text-gray-800">
              {pendingTool.tool_name}
            </div>
          </div>

          <div className="mb-4">
            <span className="text-sm text-gray-500">Arguments:</span>
            <pre className="mt-1 bg-gray-50 rounded p-3 text-sm text-gray-700 overflow-x-auto max-h-48 border">
              {JSON.stringify(pendingTool.args, null, 2)}
            </pre>
          </div>

          <div className="mb-4">
            <label className="block text-sm text-gray-500 mb-1">
              Feedback (optional, for rejection):
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              rows={2}
              placeholder="Reason for rejection..."
            />
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={handleApprove}
              disabled={isLoading}
              className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Processing...' : 'Approve'}
            </button>
            <button
              onClick={handleReject}
              disabled={isLoading}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Processing...' : 'Reject'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
