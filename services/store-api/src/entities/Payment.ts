import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Order } from './Order';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  order_id!: string;

  @ManyToOne(() => Order, order => order.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column()
  method!: string; // e.g., 'credit_card', 'paypal', 'bank_transfer'

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value)
    }
  })
  amount!: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn()
  created_at!: Date;
}
