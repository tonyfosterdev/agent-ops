import { EventEmitter } from 'events';
import { AppDataSource } from '../database';
import { Run } from '../entities/Run';
import { JournalEntry } from '../entities/JournalEntry';
import type { JournalEvent, RunStatus, AgentType } from '../types/journal';
import { logger } from '../config';

/**
 * Enriched journal event with source run metadata.
 * Used when streaming events through SSE to distinguish events from different runs.
 */
export interface EnrichedJournalEvent {
  id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
  source_run_id: string;
  source_agent_type: string | null;
}

export class JournalService {
  private runRepository = AppDataSource.getRepository(Run);
  private entryRepository = AppDataSource.getRepository(JournalEntry);
  private emitter = new EventEmitter();
  private agentTypeCache = new Map<string, string | null>();

  /**
   * Create a new run
   */
  async createRun(prompt: string, userId: string, agentType: AgentType = 'orchestrator'): Promise<string> {
    const run = this.runRepository.create({
      prompt,
      user_id: userId,
      agent_type: agentType,
      status: 'pending',
      current_step: 0,
    });

    const saved = await this.runRepository.save(run);
    logger.info({ runId: saved.id, userId, agentType }, 'Created new run');
    return saved.id;
  }

  /**
   * Create a child run (for delegation)
   */
  async createChildRun(
    prompt: string,
    userId: string,
    parentRunId: string,
    agentType: AgentType
  ): Promise<string> {
    const run = this.runRepository.create({
      prompt,
      user_id: userId,
      parent_run_id: parentRunId,
      agent_type: agentType,
      status: 'pending',
      current_step: 0,
    });

    const saved = await this.runRepository.save(run);
    logger.info({ runId: saved.id, parentRunId, agentType }, 'Created child run');
    return saved.id;
  }

  /**
   * Append an event to the journal and emit to subscribers
   *
   * This is the standard append method for non-Inngest code paths.
   * For Inngest step functions that may retry, use appendEventIdempotent().
   */
  async appendEvent(runId: string, event: JournalEvent): Promise<void> {
    // Get next sequence number
    const lastEntry = await this.entryRepository.findOne({
      where: { run_id: runId },
      order: { sequence: 'DESC' },
    });
    const sequence = (lastEntry?.sequence ?? -1) + 1;

    const entry = this.entryRepository.create({
      run_id: runId,
      sequence,
      event_type: event.type,
      payload: event.payload as unknown as Record<string, unknown>,
    });

    const saved = await this.entryRepository.save(entry);
    logger.debug({ runId, eventType: event.type, sequence }, 'Appended event');

    // Get cached agent type (set at run creation or subscription)
    const agentType = this.agentTypeCache.get(runId) ?? null;

    // Emit enriched event synchronously after save - no async in emit path
    const enriched: EnrichedJournalEvent = {
      id: saved.id,
      sequence: saved.sequence,
      event_type: saved.event_type,
      payload: saved.payload,
      created_at: saved.created_at,
      source_run_id: runId,
      source_agent_type: agentType,
    };
    this.emitter.emit(`run:${runId}`, enriched);
  }

  /**
   * Append an event to the journal with idempotency support for Inngest retries.
   *
   * This method safely handles Inngest step retries by checking if an event
   * with the given idempotency key already exists. If it does, the existing
   * event is returned without creating a duplicate.
   *
   * Uses a transactionally safe subquery to assign sequence numbers, preventing
   * race conditions when multiple concurrent appends occur for the same run.
   *
   * @param runId - The run to append the event to
   * @param event - The journal event to append
   * @param idempotencyKey - Unique key for this event within the run (typically the Inngest step ID)
   * @returns The journal entry (either newly created or existing)
   */
  async appendEventIdempotent(
    runId: string,
    event: JournalEvent,
    idempotencyKey: string
  ): Promise<JournalEntry> {
    // Check if event with this idempotency key already exists
    const existing = await this.entryRepository.findOne({
      where: { run_id: runId, idempotency_key: idempotencyKey },
    });

    if (existing) {
      logger.debug(
        { runId, eventType: event.type, idempotencyKey },
        'Idempotent event already exists, skipping duplicate'
      );
      return existing;
    }

    try {
      // Use a transactionally safe INSERT with subquery to prevent sequence race conditions.
      // The MAX(sequence) is calculated atomically within the INSERT, ensuring no gaps
      // or duplicates even under concurrent appends.
      const result = await this.entryRepository.query(
        `
        INSERT INTO journal_entries (run_id, sequence, event_type, payload, idempotency_key)
        SELECT $1, COALESCE(MAX(sequence), -1) + 1, $2, $3, $4
        FROM journal_entries WHERE run_id = $1
        RETURNING id, run_id, sequence, event_type, payload, idempotency_key, created_at
        `,
        [runId, event.type, JSON.stringify(event.payload), idempotencyKey]
      );

      // Query returns an array of rows; we expect exactly one
      const row = result[0];
      const saved: JournalEntry = {
        id: row.id,
        run_id: row.run_id,
        sequence: row.sequence,
        event_type: row.event_type,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        idempotency_key: row.idempotency_key,
        created_at: row.created_at,
      } as JournalEntry;

      logger.debug({ runId, eventType: event.type, sequence: saved.sequence, idempotencyKey }, 'Appended idempotent event');

      // Get cached agent type (set at run creation or subscription)
      const agentType = this.agentTypeCache.get(runId) ?? null;

      // Emit enriched event synchronously after save - no async in emit path
      const enriched: EnrichedJournalEvent = {
        id: saved.id,
        sequence: saved.sequence,
        event_type: saved.event_type,
        payload: saved.payload,
        created_at: saved.created_at,
        source_run_id: runId,
        source_agent_type: agentType,
      };
      this.emitter.emit(`run:${runId}`, enriched);

      return saved;
    } catch (error: any) {
      // Handle race condition where another request inserted between our check and insert
      // PostgreSQL unique constraint violation code is '23505'
      if (error.code === '23505' && error.constraint === 'UQ_journal_run_idempotency') {
        logger.debug(
          { runId, eventType: event.type, idempotencyKey },
          'Idempotent event race condition - fetching existing'
        );
        const raceExisting = await this.entryRepository.findOne({
          where: { run_id: runId, idempotency_key: idempotencyKey },
        });
        if (raceExisting) {
          return raceExisting;
        }
      }
      // Re-throw if it's a different error
      throw error;
    }
  }

  /**
   * Load all events for a run in order
   */
  async getEvents(runId: string): Promise<JournalEntry[]> {
    return this.entryRepository.find({
      where: { run_id: runId },
      order: { sequence: 'ASC' },
    });
  }

  /**
   * Get events since a specific sequence number (for SSE polling)
   */
  async getEventsSince(runId: string, afterSequence: number): Promise<JournalEntry[]> {
    return this.entryRepository
      .createQueryBuilder('entry')
      .where('entry.run_id = :runId', { runId })
      .andWhere('entry.sequence > :afterSequence', { afterSequence })
      .orderBy('entry.sequence', 'ASC')
      .getMany();
  }

  /**
   * Get limited events for a run (for snapshot endpoint)
   */
  async getEventsLimited(runId: string, limit: number): Promise<JournalEntry[]> {
    return this.entryRepository.find({
      where: { run_id: runId },
      order: { sequence: 'ASC' },
      take: limit,
    });
  }

  /**
   * Get total count of events for a run
   */
  async getEventCount(runId: string): Promise<number> {
    return this.entryRepository.count({ where: { run_id: runId } });
  }

  /**
   * Get run by ID
   */
  async getRun(runId: string): Promise<Run | null> {
    return this.runRepository.findOne({ where: { id: runId } });
  }

  /**
   * Get run with all entries
   */
  async getRunWithEntries(runId: string): Promise<Run | null> {
    return this.runRepository.findOne({
      where: { id: runId },
      relations: ['entries'],
      order: { entries: { sequence: 'ASC' } },
    });
  }

  /**
   * Update run status
   */
  async updateStatus(runId: string, status: RunStatus): Promise<void> {
    const updateData: Partial<Run> = { status };

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completed_at = new Date();
    }

    await this.runRepository.update(runId, updateData);
    logger.info({ runId, status }, 'Run status updated');
  }

  /**
   * Increment step counter
   */
  async incrementStep(runId: string): Promise<void> {
    await this.runRepository.increment({ id: runId }, 'current_step', 1);
  }

  /**
   * List runs with pagination
   */
  async listRuns(options: {
    userId?: string;
    status?: RunStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ runs: Run[]; total: number }> {
    const { userId, status, limit = 20, offset = 0 } = options;

    const qb = this.runRepository.createQueryBuilder('run');

    if (userId) {
      qb.andWhere('run.user_id = :userId', { userId });
    }

    if (status) {
      qb.andWhere('run.status = :status', { status });
    }

    qb.orderBy('run.created_at', 'DESC').skip(offset).take(limit);

    const [runs, total] = await qb.getManyAndCount();
    return { runs, total };
  }

  /**
   * Find the pending tool from events (used for resume)
   * Alias for findPendingToolFromEntries for backwards compatibility.
   */
  findPendingTool(entries: JournalEntry[]): { tool_name: string; args: Record<string, unknown>; call_id: string } | null {
    return this.findPendingToolFromEntries(entries);
  }

  /**
   * Find the pending tool from journal entries
   */
  findPendingToolFromEntries(entries: JournalEntry[]): { tool_name: string; args: Record<string, unknown>; call_id: string } | null {
    // Find the last TOOL_PROPOSED that doesn't have a corresponding TOOL_RESULT
    const proposedTools: Map<string, { tool_name: string; args: Record<string, unknown>; call_id: string }> = new Map();
    const completedTools: Set<string> = new Set();

    for (const entry of entries) {
      if (entry.event_type === 'TOOL_PROPOSED') {
        const payload = entry.payload as { tool_name: string; args: Record<string, unknown>; call_id: string };
        proposedTools.set(payload.call_id, payload);
      } else if (entry.event_type === 'TOOL_RESULT') {
        const payload = entry.payload as { call_id: string };
        completedTools.add(payload.call_id);
      }
    }

    // Find the first proposed tool that hasn't been completed
    for (const [callId, tool] of proposedTools) {
      if (!completedTools.has(callId)) {
        return tool;
      }
    }

    return null;
  }

  /**
   * Cache agent type for a run to avoid async lookup in emit path
   */
  cacheAgentType(runId: string, agentType: string | null): void {
    this.agentTypeCache.set(runId, agentType);
  }

  /**
   * Subscribe to events for a run
   * @returns Unsubscribe function
   */
  subscribe(runId: string, callback: (event: EnrichedJournalEvent) => void): () => void {
    // Wrap callback in try-catch to prevent errors from crashing emit
    const safeCallback = (event: EnrichedJournalEvent) => {
      try {
        callback(event);
      } catch (error) {
        logger.error({ error, runId }, 'Error in subscription callback');
      }
    };
    this.emitter.on(`run:${runId}`, safeCallback);
    return () => this.emitter.off(`run:${runId}`, safeCallback);
  }

  /**
   * Clean up cache when run reaches terminal state
   */
  cleanupCache(runId: string): void {
    this.agentTypeCache.delete(runId);
  }
}

// Singleton instance
export const journalService = new JournalService();
