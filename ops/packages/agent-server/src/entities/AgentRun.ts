import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Session } from './Session.js';
import { JournalEntry } from './JournalEntry.js';

export type RunStatus = 'running' | 'completed' | 'failed';

@Entity('agent_runs')
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  session_id!: string;

  @ManyToOne(() => Session, (session) => session.runs)
  @JoinColumn({ name: 'session_id' })
  session!: Session;

  @Column({ type: 'int' })
  run_number!: number;

  @Column({ type: 'varchar', length: 50 })
  agent_type!: string;

  @Column({ type: 'text' })
  task!: string;

  @Column({ type: 'varchar', length: 20, default: 'running' })
  @Index()
  status!: RunStatus;

  @Column({ type: 'jsonb', nullable: true })
  config?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  context_summary?: string;

  @Column({ type: 'timestamp', default: () => 'NOW()' })
  started_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at?: Date;

  @OneToMany(() => JournalEntry, (entry) => entry.run)
  entries!: JournalEntry[];

  @CreateDateColumn()
  created_at!: Date;
}
