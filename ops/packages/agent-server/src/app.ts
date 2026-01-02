import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { basicAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import healthRoutes from './routes/health';
import runsRoutes from './routes/runs';
import { inngestHandler } from './inngest/serve';

export function createApp() {
  const app = new Hono();

  // Global middleware
  app.use('*', honoLogger());
  app.use(
    '*',
    cors({
      origin: [
        'http://localhost:5173',      // Vite dev server
        'http://localhost:3000',      // Local dev
        'http://localhost:3001',      // Dashboard (Docker)
        'http://dashboard.localhost', // Dashboard (Traefik)
      ],
      credentials: true,
    })
  );
  app.use('*', errorHandler);

  // Public routes (no auth)
  app.route('/health', healthRoutes);

  // Durable Runs routes (public - no auth for dashboard ease of use)
  app.route('/runs', runsRoutes);

  // Inngest handler - receives events from Inngest Dev Server/Cloud
  // This endpoint must be accessible by the Inngest infrastructure
  app.route('/api/inngest', inngestHandler);

  return app;
}
