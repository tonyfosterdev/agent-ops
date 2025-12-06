import bcrypt from 'bcrypt';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { UserRole } from '@agentops/shared';

export class AuthService {
  private userRepo = AppDataSource.getRepository(User);

  async register(email: string, password: string, role: UserRole = UserRole.CUSTOMER): Promise<User> {
    const existingUser = await this.userRepo.findOne({ where: { email } });
    if (existingUser) {
      throw new Error('User already exists');
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = this.userRepo.create({
      email,
      password_hash,
      role,
    });

    return await this.userRepo.save(user);
  }

  async login(email: string, password: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new Error('Invalid credentials');
    }

    return user;
  }
}
