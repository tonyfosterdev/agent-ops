import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Order } from './Order';
import { Book } from './Book';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  order_id!: string;

  @ManyToOne(() => Order, order => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column({ type: 'uuid' })
  book_id!: string;

  @ManyToOne(() => Book)
  @JoinColumn({ name: 'book_id' })
  book!: Book;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value)
    }
  })
  price!: number;

  @CreateDateColumn()
  created_at!: Date;
}
