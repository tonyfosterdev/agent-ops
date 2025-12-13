import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

@Entity('tool_approvals')
export class ToolApproval {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  run_id!: string;

  @Column({ type: 'varchar', length: 100 })
  tool_call_id!: string;

  @Column({ type: 'varchar', length: 100 })
  tool_name!: string;

  @Column({ type: 'jsonb' })
  args!: Record<string, unknown>;

  @Column({ type: 'int' })
  step_number!: number;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  @Index()
  status!: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  rejection_reason?: string;

  @Column({ type: 'timestamp', nullable: true })
  resolved_at?: Date;

  @CreateDateColumn()
  created_at!: Date;
}
