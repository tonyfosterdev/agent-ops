/**
 * Human-in-the-Middle (HITM) Tool Wrapper
 *
 * Wraps tools to require human approval before execution.
 * Uses a context pattern to pass the OutputSink and step number to wrapped tools.
 */

import { tool } from 'ai';
import type { OutputSink } from '../sinks/OutputSink.js';

/**
 * Context for tool execution - holds the sink and current step number
 */
interface ToolExecutionContext {
  sink: OutputSink;
  stepNumber: number;
  generateToolCallId: () => string;
}

// Module-level context storage
let currentContext: ToolExecutionContext | null = null;

/**
 * Set the tool execution context before calling generateText
 */
export function setToolContext(context: ToolExecutionContext | null): void {
  currentContext = context;
}

/**
 * Get the current tool execution context
 */
export function getToolContext(): ToolExecutionContext | null {
  return currentContext;
}

/**
 * Update the step number in the current context
 */
export function updateStepNumber(stepNumber: number): void {
  if (currentContext) {
    currentContext.stepNumber = stepNumber;
  }
}

/**
 * Tools that don't require human approval (delegation tools)
 */
const AUTO_APPROVE_TOOLS = new Set([
  'run_coding_agent',
  'run_log_analyzer_agent',
  'run_both_agents',
]);

/**
 * Result returned when a tool is rejected
 */
interface RejectedResult {
  success: false;
  error: string;
  _rejected: true;
  rejectionReason?: string;
}

// Type for AI SDK tools - using any for flexibility with dynamic wrapping
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AITool = any;

/**
 * Wrap a tool to require human approval before execution.
 *
 * @param originalTool - The original tool created with tool()
 * @param toolName - The name of the tool (used for approval tracking)
 * @returns A new tool that requests approval before executing
 */
export function wrapToolWithApproval(
  originalTool: AITool,
  toolName: string
): AITool {
  // Don't wrap delegation tools - they auto-approve
  if (AUTO_APPROVE_TOOLS.has(toolName)) {
    return originalTool;
  }

  // Create a new tool with the same schema but approval-wrapped execute
  return tool({
    description: originalTool.description,
    parameters: originalTool.parameters,
    execute: async (args: Record<string, unknown>, options: { toolCallId?: string }) => {
      const context = getToolContext();

      if (!context) {
        // No context means we're in a non-HITM environment (e.g., tests)
        // Fall back to original execution
        return originalTool.execute(args, options);
      }

      const { sink, stepNumber } = context;
      const toolCallId = options?.toolCallId || context.generateToolCallId();

      // Request approval - this BLOCKS until human responds
      const approval = await sink.writeToolPendingApproval(
        toolName,
        toolCallId,
        args,
        stepNumber
      );

      if (!approval.approved) {
        // Return a rejection result that the agent can observe
        const rejectedResult: RejectedResult = {
          success: false,
          error: `Tool execution rejected by human: ${approval.rejectionReason || 'No reason provided'}`,
          _rejected: true,
          rejectionReason: approval.rejectionReason,
        };
        return rejectedResult;
      }

      // Approved - execute the original tool
      return originalTool.execute(args, options);
    },
  });
}

/**
 * Wrap multiple tools with approval requirement
 *
 * @param tools - Object mapping tool names to tool instances
 * @returns Object with the same keys but approval-wrapped tools
 */
export function wrapToolsWithApproval<T extends Record<string, AITool>>(tools: T): T {
  const wrappedTools: Record<string, AITool> = {};

  for (const [toolName, toolInstance] of Object.entries(tools)) {
    wrappedTools[toolName] = wrapToolWithApproval(toolInstance, toolName);
  }

  return wrappedTools as T;
}

/**
 * Generate a unique tool call ID
 */
export function generateToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
