import type { OutputSink } from './OutputSink.js';

/**
 * OutputSink implementation that does nothing.
 * Used for sub-agent delegation where output is captured by the parent agent.
 */
export class NoOpOutputSink implements OutputSink {
  async writeRunStarted(): Promise<void> {}
  async writeThinking(): Promise<void> {}
  async writeText(): Promise<void> {}
  async writeToolStarting(): Promise<void> {}
  async writeToolComplete(): Promise<void> {}
  async writeStepComplete(): Promise<void> {}
  async writeRunComplete(): Promise<void> {}
  async writeRunError(): Promise<void> {}
}
