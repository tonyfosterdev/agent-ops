import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { basicAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import healthRoutes from './routes/health';
import runsRoutes from './routes/runs';

export function createApp() {
  const app = new Hono();

  // Global middleware
  app.use('*', honoLogger());
  app.use(
    '*',
    cors({
      origin: ['http://localhost:5173', 'http://localhost:3000'], // Vite dev + local
      credentials: true,
    })
  );
  app.use('*', errorHandler);

  // Public routes (no auth)
  app.route('/health', healthRoutes);

  // Durable Runs routes (public - no auth for dashboard ease of use)
  app.route('/runs', runsRoutes);

  return app;
}
