import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { UserRole } from '@agentops/shared';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  @Index()
  email!: string;

  @Column()
  password_hash!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CUSTOMER,
  })
  role!: UserRole;

  @Column({ nullable: true })
  first_name?: string;

  @Column({ nullable: true })
  last_name?: string;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
