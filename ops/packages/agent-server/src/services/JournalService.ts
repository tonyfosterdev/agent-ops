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
