/**
 * Streaming helper utilities for processing AI SDK streams
 * and emitting real-time events
 */

import type { StreamTextResult, CoreTool } from 'ai';

/**
 * Callbacks for stream processing events
 */
export interface StreamingCallbacks {
  onTextChunk: (chunk: string, isComplete: boolean) => void;
  onToolCallStreamingStart: (toolCallId: string, toolName: string) => void;
  onToolCall: (toolCallId: string, toolName: string, args: unknown) => void;
  onToolResult: (toolCallId: string, toolName: string, result: unknown) => void;
  onStepComplete: (stepNumber: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Buffer that accumulates text and flushes on word boundaries
 * for smoother display than character-by-character streaming
 */
export class WordBuffer {
  private buffer = '';

  /**
   * Add text to buffer and flush complete words
   * @param text - Incoming text delta
   * @param flush - Callback to receive flushed words
   */
  add(text: string, flush: (words: string) => void): void {
    this.buffer += text;

    // Find last word boundary (space or newline)
    const lastBoundary = Math.max(
      this.buffer.lastIndexOf(' '),
      this.buffer.lastIndexOf('\n')
    );

    if (lastBoundary > 0) {
      const toFlush = this.buffer.substring(0, lastBoundary + 1);
      this.buffer = this.buffer.substring(lastBoundary + 1);
      flush(toFlush);
    }
  }

  /**
   * Flush any remaining text in the buffer
   * @param flush - Callback to receive remaining text
   */
  flushRemaining(flush: (words: string) => void): void {
    if (this.buffer) {
      flush(this.buffer);
      this.buffer = '';
    }
  }

  /**
   * Check if buffer has content
   */
  hasContent(): boolean {
    return this.buffer.length > 0;
  }
}

/**
 * Process an AI SDK stream and emit events in real-time
 *
 * IMPORTANT: This function must be called and awaited for streaming to work.
 * The AI SDK uses backpressure - onChunk callbacks only fire if the stream is consumed.
 *
 * @param result - The StreamTextResult from streamText()
 * @param callbacks - Event callbacks for each stream event type
 */
export async function processStream<TOOLS extends Record<string, CoreTool>>(
  result: StreamTextResult<TOOLS>,
  callbacks: StreamingCallbacks
): Promise<void> {
  const wordBuffer = new WordBuffer();
  let currentStep = 1;

  try {
    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
          wordBuffer.add(chunk.textDelta, (words) => {
            callbacks.onTextChunk(words, false);
          });
          break;

        case 'tool-call-streaming-start':
          // Flush any buffered text before showing tool notification
          wordBuffer.flushRemaining((words) => {
            callbacks.onTextChunk(words, false);
          });
          // Tool call is beginning but args aren't complete yet
          callbacks.onToolCallStreamingStart(
            chunk.toolCallId,
            chunk.toolName
          );
          break;

        case 'tool-call':
          // Flush any buffered text before tool execution
          wordBuffer.flushRemaining((words) => {
            callbacks.onTextChunk(words, false);
          });
          // Tool args are now complete, tool will execute
          callbacks.onToolCall(
            chunk.toolCallId,
            chunk.toolName,
            chunk.args
          );
          break;

        case 'tool-result':
          // Tool execution completed
          callbacks.onToolResult(
            chunk.toolCallId,
            chunk.toolName,
            chunk.result
          );
          break;

        case 'step-finish':
          // Flush any remaining buffered text
          wordBuffer.flushRemaining((words) => {
            callbacks.onTextChunk(words, false);
          });
          // Mark text as complete for this step
          callbacks.onTextChunk('', true);
          callbacks.onStepComplete(currentStep);
          currentStep++;
          break;

        case 'error':
          if (callbacks.onError) {
            callbacks.onError(
              chunk.error instanceof Error
                ? chunk.error
                : new Error(String(chunk.error))
            );
          }
          break;

        // Ignore other chunk types (reasoning, etc.)
        default:
          break;
      }
    }
  } catch (error) {
    // Flush any remaining text before error
    wordBuffer.flushRemaining((words) => {
      callbacks.onTextChunk(words, false);
    });

    if (callbacks.onError) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
    throw error;
  }
}
