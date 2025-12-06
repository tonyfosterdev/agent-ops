import { Context, Next } from 'koa';
import bcrypt from 'bcrypt';
import { AppDataSource } from '../database';
import { User } from '../entities/User';
import { UserRole } from '@agentops/shared';

export async function basicAuth(ctx: Context, next: Next): Promise<void> {
  const authHeader = ctx.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    ctx.status = 401;
    ctx.set('WWW-Authenticate', 'Basic');
    ctx.body = { error: 'Authentication required' };
    return;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [email, password] = credentials.split(':');

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    ctx.status = 401;
    ctx.body = { error: 'Invalid credentials' };
    return;
  }

  // Attach user to context
  ctx.state.user = user;
  await next();
}

export function requireRole(...roles: UserRole[]) {
  return async (ctx: Context, next: Next): Promise<void> => {
    const user = ctx.state.user as User;

    if (!user || !roles.includes(user.role)) {
      ctx.status = 403;
      ctx.body = { error: 'Insufficient permissions' };
      return;
    }

    await next();
  };
}
