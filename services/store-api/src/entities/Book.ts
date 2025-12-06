import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('books')
export class Book {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  isbn!: string;

  @Column()
  title!: string;

  @Column()
  author!: string;

  @Column({ nullable: true })
  publisher?: string;

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

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ nullable: true })
  genre?: string;

  @Column({ type: 'int', nullable: true })
  publication_year?: number;

  @Column({ default: true })
  is_active!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
