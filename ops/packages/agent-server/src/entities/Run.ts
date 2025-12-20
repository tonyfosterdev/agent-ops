import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { JournalEntry } from './JournalEntry';
import type { RunStatus, AgentType } from '../types/journal';

@Entity('runs')
export class Run {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  user_id!: string;

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  @Index()
  status!: RunStatus;

  @Column({ type: 'int', default: 0 })
  current_step!: number;

  @Column({ type: 'varchar', length: 50, default: 'orchestrator' })
  @Index()
  agent_type!: AgentType;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  parent_run_id?: string;

  @ManyToOne(() => Run, { nullable: true })
  @JoinColumn({ name: 'parent_run_id' })
  parent?: Run;

  @OneToMany(() => Run, (run) => run.parent)
  children!: Run[];

  @OneToMany(() => JournalEntry, (entry) => entry.run)
  entries!: JournalEntry[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at?: Date;
}
