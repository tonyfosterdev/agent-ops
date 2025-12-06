import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { Book } from './Book';
import { WarehouseRegistry } from './WarehouseRegistry';

@Entity('inventory_cache')
@Index(['book_id', 'warehouse_id'], { unique: true })
export class InventoryCache {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  book_id!: string;

  @ManyToOne(() => Book)
  @JoinColumn({ name: 'book_id' })
  book!: Book;

  @Column({ type: 'uuid' })
  warehouse_id!: string;

  @ManyToOne(() => WarehouseRegistry)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: WarehouseRegistry;

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  @Column({ type: 'timestamp', nullable: true })
  last_synced?: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
