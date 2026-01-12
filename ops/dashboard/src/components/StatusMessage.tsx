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
