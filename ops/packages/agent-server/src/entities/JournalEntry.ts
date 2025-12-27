import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Run } from './Run';
import type { JournalEventType } from '../types/journal';

@Entity('journal_entries')
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

  @CreateDateColumn()
  created_at!: Date;
}
