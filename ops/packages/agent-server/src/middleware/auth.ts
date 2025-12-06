import { Context, Next } from 'hono';
import { config } from '../config';

export async function basicAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Basic ')) {
    c.header('WWW-Authenticate', 'Basic realm="Agent Server"');
    return c.json({ error: 'Authentication required' }, 401);
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  // Check against environment variables
  if (username !== config.auth.username || password !== config.auth.password) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  await next();
}
