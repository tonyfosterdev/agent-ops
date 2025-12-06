import Router from 'koa-router';
import { Context } from 'koa';
import { bearerAuth } from '../middleware/bearerAuth';
import { config } from '../config';
import { HealthCheckResponse } from '@agentops/shared';

const router = new Router();

// Health check (for Store API)
router.get('/health', bearerAuth, async (ctx: Context) => {
  const response: HealthCheckResponse = {
    status: 'healthy',
    timestamp: new Date(),
  };
  ctx.body = response;
});

// Warehouse info (public)
router.get('/info', async (ctx: Context) => {
  ctx.body = {
    name: config.warehouse.name,
    url: config.warehouse.url,
  };
});

export default router;
