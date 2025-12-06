import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('shipment_logs')
export class ShipmentLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  order_id!: string; // References Store's Order entity

  @Column({ type: 'uuid' })
  book_id!: string;

  @Column()
  isbn!: string;

  @Column({ type: 'int' })
  quantity!: number;

  @CreateDateColumn()
  shipped_at!: Date;
}
