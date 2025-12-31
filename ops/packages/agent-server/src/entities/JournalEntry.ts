import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { Run } from './Run';
import type { JournalEventType } from '../types/journal';

/**
 * JournalEntry represents a single event in the agent run journal.
 *
 * The journal follows an append-only event sourcing pattern where all state
 * changes are recorded as immutable events. This enables crash recovery,
 * replay, and audit capabilities.
 *
 * The idempotency_key field supports safe retries in Inngest step functions.
 * When set, it ensures that the same event is not recorded twice during
 * step retries.
 */
@Entity('journal_entries')
@Unique('UQ_journal_run_idempotency', ['run_id', 'idempotency_key'])
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  run_id!: string;

  @ManyToOne(() => Run, (run) => run.entries)
  @JoinColumn({ name: 'run_id' })
  run!: Run;

  @Column({ type: 'int' })
  @Index()
  sequence!: number;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  event_type!: JournalEventType;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /**
   * Optional idempotency key for safe Inngest step retries.
   *
   * When provided, the appendEventIdempotent() method uses this key to
   * detect and skip duplicate inserts. The key should be derived from
   * the Inngest step ID to ensure uniqueness within a run.
   *
   * The unique constraint on (run_id, idempotency_key) is partial -
   * it only applies when idempotency_key is not null. This allows
   * events without idempotency keys to be inserted normally.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index('IDX_journal_idempotency_key', { where: 'idempotency_key IS NOT NULL' })
  idempotency_key?: string;

  @CreateDateColumn()
  created_at!: Date;
}
