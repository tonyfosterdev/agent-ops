import { Context, Next } from 'koa';
import { config } from '../config';

export async function bearerAuth(ctx: Context, next: Next): Promise<void> {
  const authHeader = ctx.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { error: 'Bearer token required' };
    return;
  }

  const token = authHeader.split(' ')[1];

  if (token !== config.auth.serviceSecret) {
    ctx.status = 401;
    ctx.body = { error: 'Invalid service token' };
    return;
  }

  await next();
}
