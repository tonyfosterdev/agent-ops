import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { basicAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import agentRoutes from './routes/agents';
import healthRoutes from './routes/health';

export function createApp() {
  const app = new Hono();

  // Global middleware
  app.use('*', honoLogger());
  app.use('*', cors());
  app.use('*', errorHandler);

  // Public routes (no auth)
  app.route('/health', healthRoutes);

  // Protected routes (basic auth required)
  app.use('/agents/*', basicAuth);
  app.route('/agents', agentRoutes);

  return app;
}
