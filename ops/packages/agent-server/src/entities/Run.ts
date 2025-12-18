import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { JournalEntry } from './JournalEntry';
import type { RunStatus } from '../types/journal';

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

  @OneToMany(() => JournalEntry, (entry) => entry.run)
  entries!: JournalEntry[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at?: Date;
}
