import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AgentRun } from './AgentRun.js';

@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  run_id!: string;

  @ManyToOne(() => AgentRun, (run) => run.entries)
  @JoinColumn({ name: 'run_id' })
  run!: AgentRun;

  @Column({ type: 'int' })
  @Index()
  sequence_number!: number;

  @Column({ type: 'varchar', length: 50 })
  entry_type!: string;

  @Column({ type: 'int', nullable: true })
  step_number?: number;

  @Column({ type: 'jsonb' })
  data!: Record<string, any>;

  @CreateDateColumn()
  created_at!: Date;
}
