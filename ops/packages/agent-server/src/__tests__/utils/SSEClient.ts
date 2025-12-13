/**
 * SSE Test Client
 *
 * Subscribes to Server-Sent Events from the run subscription endpoint.
 */

export interface SSEJournalEntry {
  id: string;
  entry_type: string;
  step_number?: number;
  data: Record<string, unknown>;
  created_at: string;
}

export interface SSEEntryEvent {
  type: 'entry';
  entry: SSEJournalEntry;
}

export interface SSECompleteEvent {
  type: 'complete';
  run: {
    id: string;
    status: string;
    result?: Record<string, unknown>;
  };
}

export type SSEEvent = SSEEntryEvent | SSECompleteEvent;

export class SSESubscription {
  private entries: SSEJournalEntry[] = [];
  private completeEvent: SSECompleteEvent['run'] | null = null;
  private abortController: AbortController;
  private promise: Promise<void>;
  private resolveComplete: (() => void) | null = null;
  private rejectComplete: ((error: Error) => void) | null = null;

  constructor(
    baseUrl: string,
    runId: string,
    auth: { username: string; password: string }
  ) {
    this.abortController = new AbortController();
    const authHeader = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');

    this.promise = new Promise<void>((resolve, reject) => {
      this.resolveComplete = resolve;
      this.rejectComplete = reject;

      this.startStream(baseUrl, runId, authHeader);
    });
  }

  private async startStream(baseUrl: string, runId: string, authHeader: string): Promise<void> {
    try {
      const response = await fetch(`${baseUrl}/runs/${runId}/subscribe`, {
        headers: {
          Authorization: authHeader,
          Accept: 'text/event-stream',
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorBody}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr) as SSEEvent;
              this.handleEvent(event);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Process any remaining data
      if (buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6);
        try {
          const event = JSON.parse(jsonStr) as SSEEvent;
          this.handleEvent(event);
        } catch {
          // Ignore parse errors
        }
      }

      this.resolveComplete?.();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.resolveComplete?.();
      } else {
        this.rejectComplete?.(error as Error);
      }
    }
  }

  private handleEvent(event: SSEEvent): void {
    if (event.type === 'entry') {
      this.entries.push(event.entry);
    } else if (event.type === 'complete') {
      this.completeEvent = event.run;
    }
  }

  /**
   * Wait for a specific entry type to appear
   */
  async waitForEntry(entryType: string, timeoutMs = 10000): Promise<SSEJournalEntry> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const entry = this.entries.find((e) => e.entry_type === entryType);
      if (entry) return entry;

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Timeout waiting for entry type: ${entryType}`);
  }

  /**
   * Wait for the complete event
   */
  async waitForComplete(timeoutMs = 30000): Promise<SSECompleteEvent['run']> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout waiting for complete event')), timeoutMs);
    });

    await Promise.race([this.promise, timeoutPromise]);

    if (!this.completeEvent) {
      throw new Error('Stream ended without complete event');
    }

    return this.completeEvent;
  }

  /**
   * Get all entries received so far
   */
  getAllEntries(): SSEJournalEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries of a specific type
   */
  getEntriesByType(entryType: string): SSEJournalEntry[] {
    return this.entries.filter((e) => e.entry_type === entryType);
  }

  /**
   * Close the subscription
   */
  close(): void {
    this.abortController.abort();
  }
}

export class SSEClient {
  private baseUrl: string;
  private auth: { username: string; password: string };

  constructor(baseUrl: string, auth: { username: string; password: string }) {
    this.baseUrl = baseUrl;
    this.auth = auth;
  }

  /**
   * Subscribe to run updates
   */
  subscribe(runId: string): SSESubscription {
    return new SSESubscription(this.baseUrl, runId, this.auth);
  }
}
