/**
 * StatusMessage Component - Displays agent status/progress updates.
 *
 * Shows ephemeral status messages from agents during processing,
 * such as "Analyzing logs..." or "Querying database...".
 *
 * These messages are styled differently from regular chat messages
 * to indicate they are transient progress updates.
 */

interface StatusMessageProps {
  content: string;
  agentName?: string;
  timestamp?: string;
}

export function StatusMessage({ content, agentName, timestamp }: StatusMessageProps) {
  return (
    <div className="flex items-start gap-2 py-2 px-4 text-sm text-gray-500 dark:text-gray-400 italic">
      <div className="flex-shrink-0">
        <span className="inline-block w-2 h-2 bg-blue-400 dark:bg-blue-500 rounded-full animate-pulse" />
      </div>
      <div className="flex-1">
        {agentName && (
          <span className="font-medium text-gray-600 dark:text-gray-300">{agentName}: </span>
        )}
        <span>{content}</span>
      </div>
      {timestamp && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

/**
 * WaitingForApprovalIndicator - Shows when agent is blocked on HITL approval.
 *
 * Displayed instead of the thinking indicator when there are pending approvals.
 */
export function WaitingForApprovalIndicator() {
  return (
    <div className="flex items-center gap-2 p-4 text-amber-600 dark:text-amber-400">
      <span className="inline-block w-3 h-3 border-2 border-amber-600 dark:border-amber-400 rounded-full" />
      <span className="text-sm">Waiting for your approval...</span>
    </div>
  );
}
