import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('inventory')
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  book_id!: string; // References Store's Book entity (UUID)

  @Column()
  @Index()
  isbn!: string; // Denormalized for quick lookup

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
