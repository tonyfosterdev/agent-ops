import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { OrderStatus } from '@agentops/shared';
import { User } from './User';
import { OrderItem } from './OrderItem';
import { Payment } from './Payment';
import { WarehouseRegistry } from './WarehouseRegistry';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  user_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  @Index()
  status!: OrderStatus;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value)
    }
  })
  total!: number;

  @Column({ type: 'uuid', nullable: true })
  fulfillment_warehouse_id?: string;

  @ManyToOne(() => WarehouseRegistry, { nullable: true })
  @JoinColumn({ name: 'fulfillment_warehouse_id' })
  fulfillment_warehouse?: WarehouseRegistry;

  @Column({ type: 'timestamp', nullable: true })
  shipped_at?: Date;

  @OneToMany(() => OrderItem, orderItem => orderItem.order, { cascade: true })
  items!: OrderItem[];

  @OneToMany(() => Payment, payment => payment.order, { cascade: true })
  payments!: Payment[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
