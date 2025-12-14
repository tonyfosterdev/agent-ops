import { MoreThan } from 'typeorm';
import { AppDataSource } from '../database.js';
import { AgentRun } from '../entities/AgentRun.js';
import { JournalEntry } from '../entities/JournalEntry.js';
import type { Journal } from '../interfaces/Journal.js';

export class JournalService implements Journal {
  private runRepository = AppDataSource.getRepository(AgentRun);
  private entryRepository = AppDataSource.getRepository(JournalEntry);

  async createRun(
    sessionId: string,
    agentType: string,
    task: string,
    config?: Record<string, any>
  ): Promise<string> {
    // Get the next run number for this session
    const lastRun = await this.runRepository.findOne({
      where: { session_id: sessionId },
      order: { run_number: 'DESC' },
    });
    const runNumber = (lastRun?.run_number || 0) + 1;

    const run = this.runRepository.create({
      session_id: sessionId,
      run_number: runNumber,
      agent_type: agentType,
      task,
      config,
      status: 'running',
    });
    const saved = await this.runRepository.save(run);
    return saved.id;
  }

  async writeEntry(
    runId: string,
    entryType: string,
    data: Record<string, any>,
    stepNumber?: number
  ): Promise<JournalEntry> {
    // Get next sequence number
    const lastEntry = await this.entryRepository.findOne({
      where: { run_id: runId },
      order: { sequence_number: 'DESC' },
    });
    const sequenceNumber = (lastEntry?.sequence_number || 0) + 1;

    const entry = this.entryRepository.create({
      run_id: runId,
      sequence_number: sequenceNumber,
      entry_type: entryType,
      step_number: stepNumber,
      data,
    });
    return this.entryRepository.save(entry);
  }

  async getEntriesSince(runId: string, afterSequence: number): Promise<JournalEntry[]> {
    return this.entryRepository.find({
      where: {
        run_id: runId,
        sequence_number: MoreThan(afterSequence),
      },
      order: { sequence_number: 'ASC' },
    });
  }

  async getRun(runId: string): Promise<AgentRun | null> {
    return this.runRepository.findOne({
      where: { id: runId },
      relations: ['entries'],
    });
  }

  async getRunWithOrderedEntries(runId: string): Promise<AgentRun | null> {
    return this.runRepository.findOne({
      where: { id: runId },
      relations: ['entries'],
      order: { entries: { sequence_number: 'ASC' } },
    });
  }

  async completeRun(runId: string, result: Record<string, any>): Promise<void> {
    await this.runRepository.update(runId, {
      status: 'completed' as const,
      result,
      completed_at: new Date(),
    });
  }

  async failRun(runId: string, error: string): Promise<void> {
    await this.runRepository.update(runId, {
      status: 'failed' as const,
      result: { error } as Record<string, any>,
      completed_at: new Date(),
    });
  }

  async getRunsForSession(sessionId: string): Promise<AgentRun[]> {
    return this.runRepository.find({
      where: { session_id: sessionId },
      order: { run_number: 'ASC' },
      relations: ['entries'],
    });
  }

  async setContextSummary(runId: string, summary: string): Promise<void> {
    await this.runRepository.update(runId, { context_summary: summary });
  }
}
