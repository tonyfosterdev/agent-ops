import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { WarehouseStatus } from '@agentops/shared';

@Entity('warehouse_registry')
export class WarehouseRegistry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  name!: string;

  @Column()
  url!: string;

  @Column({ default: '' })
  internal_url!: string;

  @Column({
    type: 'enum',
    enum: WarehouseStatus,
    default: WarehouseStatus.OFFLINE,
  })
  status!: WarehouseStatus;

  @Column({ type: 'timestamp', nullable: true })
  last_seen?: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
