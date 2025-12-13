/**
 * OutputSink abstracts where agent execution output is written.
 * This allows the same agent execution logic to write to different backends
 * (e.g., database journal, console, file, etc.)
 */
export interface OutputSink {
  /**
   * Write a run:started entry - called when agent execution begins
   */
  writeRunStarted(data: {
    task: string;
    maxSteps: number;
    agentType: string;
  }): Promise<void>;

  /**
   * Write a thinking heartbeat entry - indicates agent is processing
   */
  writeThinking(elapsedMs: number): Promise<void>;

  /**
   * Write a text entry - agent's text output
   */
  writeText(text: string, stepNumber: number): Promise<void>;

  /**
   * Write a tool:starting entry - tool execution is beginning
   */
  writeToolStarting(
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
    stepNumber: number
  ): Promise<void>;

  /**
   * Write a tool:complete entry - tool execution finished
   */
  writeToolComplete(
    toolName: string,
    toolCallId: string,
    result: unknown,
    success: boolean,
    summary: string,
    stepNumber: number
  ): Promise<void>;

  /**
   * Write a step:complete entry - LLM reasoning step finished
   */
  writeStepComplete(stepNumber: number): Promise<void>;

  /**
   * Write a run:complete entry and finalize the run
   */
  writeRunComplete(result: {
    success: boolean;
    message: string;
    steps: number;
  }): Promise<void>;

  /**
   * Write a run:error entry and mark run as failed
   */
  writeRunError(error: string): Promise<void>;
}
