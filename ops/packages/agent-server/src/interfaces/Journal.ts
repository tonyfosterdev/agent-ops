import type { AgentRun } from '../entities/AgentRun.js';
import type { JournalEntry } from '../entities/JournalEntry.js';

/**
 * Journal interface for writing agent execution entries.
 * Allows dependency injection and testability.
 */
export interface Journal {
  writeEntry(
    runId: string,
    entryType: string,
    data: Record<string, any>,
    stepNumber?: number
  ): Promise<JournalEntry>;

  getEntriesSince(runId: string, afterSequence: number): Promise<JournalEntry[]>;
  getRun(runId: string): Promise<AgentRun | null>;
  getRunsForSession(sessionId: string): Promise<AgentRun[]>;
  completeRun(runId: string, result: Record<string, any>): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
}
