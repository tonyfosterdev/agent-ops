/**
 * Network state key constants.
 *
 * These keys are used for agent communication via network.state.kv.
 * Centralizing them prevents typos and enables IDE autocomplete.
 */

export const STATE_KEYS = {
  /** Findings from log analysis (set by log-analyzer, read by coding agent) */
  LOG_FINDINGS: 'log_findings',

  /** Explicit handoff request from agent (consumed and cleared by router) */
  ROUTE_TO: 'route_to',

  /** Set to true when work is done (network stops) */
  COMPLETE: 'complete',

  /** How the task completed: 'agent_completed' or 'forced_loop_detection' */
  COMPLETION_TYPE: 'completion_type',

  /** Final task summary with success status and details */
  TASK_SUMMARY: 'task_summary',

  /** Inngest run ID for HITL event correlation */
  RUN_ID: 'runId',

  /** Thread ID for history persistence */
  THREAD_ID: 'threadId',

  /** User ID for thread ownership */
  USER_ID: 'userId',

  /** Agent suggested handoff, awaiting user confirmation */
  HANDOFF_SUGGESTED: 'handoff_suggested',

  /** Router flagged ambiguous input, agent should ask for clarification */
  NEEDS_CLARIFICATION: 'needs_clarification',

  /** Loop detection: iterations without progress */
  ITER_WITHOUT_PROGRESS: 'iter_without_progress',

  /** Currently active agent name */
  CURRENT_AGENT: 'currentAgent',
} as const;

/** Type for state key values */
export type StateKey = (typeof STATE_KEYS)[keyof typeof STATE_KEYS];
