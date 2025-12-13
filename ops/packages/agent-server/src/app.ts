import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { basicAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import agentRoutes from './routes/agents.js';
import healthRoutes from './routes/health.js';
import sessionRoutes from './routes/sessions.js';
import runRoutes from './routes/runs.js';

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
  app.use('/sessions/*', basicAuth);
  app.use('/runs/*', basicAuth);

  app.route('/agents', agentRoutes);
  app.route('/sessions', sessionRoutes);
  app.route('/runs', runRoutes);

  return app;
}
