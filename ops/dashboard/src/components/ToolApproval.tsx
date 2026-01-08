/**
 * ToolApproval Component - HITL approval UI for dangerous tool calls.
 *
 * Displays tool call details and allows users to approve or reject
 * the execution. This is a critical security component that prevents
 * agents from executing dangerous operations without human oversight.
 *
 * ## Features
 * - Visual display of tool name and arguments
 * - Optional feedback input for rejections
 * - Clear approve/reject actions
 * - Loading state during submission
 *
 * ## Usage
 *
 * ```tsx
 * <ToolApproval
 *   tool={{ id: 'abc', name: 'shell_command_execute', args: { command: 'rm -rf /' } }}
 *   runId="inngest-run-123"
 *   onApprove={() => submitApproval(runId, toolId, true)}
 *   onDeny={(reason) => submitApproval(runId, toolId, false, reason)}
 * />
 * ```
 */

import { useState } from 'react';

export interface ToolApprovalProps {
  /** Tool call details */
  tool: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  /** Agent that requested this tool (optional) */
  agentName?: string;
  /** Reason provided by the agent for why this tool needs to run */
  reason?: string;
  /** Callback when user approves */
  onApprove: () => void;
  /** Callback when user denies with optional feedback */
  onDeny: (reason: string) => void;
  /** Whether approval is being processed */
  isSubmitting?: boolean;
}

/**
 * Format tool arguments for display.
 * Handles special cases like long strings and nested objects.
 */
function formatArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2);
}

/**
 * Get a human-readable description of the tool based on its name.
 */
function getToolDescription(toolName: string): string {
  const descriptions: Record<string, string> = {
    shell_command_execute: 'Execute a shell command on the system',
    write_file: 'Write content to a file on the filesystem',
    delete_file: 'Delete a file from the filesystem',
    create_directory: 'Create a new directory',
    move_file: 'Move or rename a file',
    // Add more tool descriptions as needed
  };

  return descriptions[toolName] || `Execute the ${toolName} tool`;
}

/**
 * Get risk level for a tool to determine styling.
 */
function getToolRiskLevel(toolName: string): 'high' | 'medium' | 'low' {
  const highRisk = ['shell_command_execute', 'delete_file', 'move_file'];
  const mediumRisk = ['write_file', 'create_directory'];

  if (highRisk.includes(toolName)) return 'high';
  if (mediumRisk.includes(toolName)) return 'medium';
  return 'low';
}

export function ToolApproval({
  tool,
  agentName,
  reason,
  onApprove,
  onDeny,
  isSubmitting = false,
}: ToolApprovalProps) {
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const riskLevel = getToolRiskLevel(tool.name);
  const description = reason || getToolDescription(tool.name);

  const handleDeny = () => {
    onDeny(feedback);
  };

  const riskColors = {
    high: {
      bg: 'bg-red-50 dark:bg-red-900/30',
      border: 'border-red-200 dark:border-red-800',
      icon: 'text-red-600 dark:text-red-400',
      badge: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300',
    },
    medium: {
      bg: 'bg-yellow-50 dark:bg-yellow-900/30',
      border: 'border-yellow-200 dark:border-yellow-800',
      icon: 'text-yellow-600 dark:text-yellow-400',
      badge: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300',
    },
    low: {
      bg: 'bg-blue-50 dark:bg-blue-900/30',
      border: 'border-blue-200 dark:border-blue-800',
      icon: 'text-blue-600 dark:text-blue-400',
      badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',
    },
  };

  const colors = riskColors[riskLevel];

  return (
    <div
      className={`${colors.bg} ${colors.border} border rounded-lg p-4 my-4 shadow-sm`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg
            className={`w-5 h-5 ${colors.icon}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h4 className="font-semibold text-gray-900 dark:text-gray-100">Approval Required</h4>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${colors.badge}`}>
          {riskLevel.toUpperCase()} RISK
        </span>
      </div>

      {/* Tool Info */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm font-medium text-gray-800 dark:text-gray-200">
            {tool.name}
          </span>
          {agentName && (
            <span className="text-xs text-gray-500 dark:text-gray-400">via {agentName}</span>
          )}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
      </div>

      {/* Arguments */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
          Arguments
        </label>
        <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-3 overflow-x-auto text-sm font-mono">
          {formatArgs(tool.args)}
        </pre>
      </div>

      {/* Feedback Input (shown when deny is clicked) */}
      {showFeedback && (
        <div className="mb-4">
          <label
            htmlFor={`feedback-${tool.id}`}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Rejection Reason (optional)
          </label>
          <textarea
            id={`feedback-${tool.id}`}
            className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 placeholder-gray-400 dark:placeholder-gray-500"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Explain why this action should not be performed..."
            rows={2}
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={isSubmitting}
          className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <svg className="animate-spin h-4 w-4\" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          Approve
        </button>
        <button
          type="button"
          onClick={showFeedback ? handleDeny : () => setShowFeedback(true)}
          disabled={isSubmitting}
          className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {showFeedback ? 'Confirm Reject' : 'Reject'}
        </button>
      </div>

      {/* Tool ID for debugging */}
      <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">
        Tool ID: {tool.id}
      </div>
    </div>
  );
}
